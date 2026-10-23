/**
 * 读出「当前对话正在用的模型」，失败时给出**卡在哪一步**。
 *
 * 自动填充不要求用户配置模型：它继承当前对话的模型。DSH 把这件事记在会话投影里
 * （`packages/api/session-controller/src/model-selection-projection.ts`）：
 *
 *  - key 是 `'modelSelection'`，state 形如 `{ lastUsed, pending }`；
 *  - `lastUsed` 来自最近一次 `request/header` 事件的 config（**真正用过**的模型）；
 *  - `pending` 是使用者刚切换、尚未生效的选择；
 *  - 取 `pending ?? lastUsed` = "下一次请求会用的模型"。
 *
 * **为什么要传入多个上下文**：本模块的调用方在 HTTP 路由里，手上是一个
 * `ctx.inject(['connection'], scoped => …)` 的**作用域**上下文。作用域里未必看得到
 * `sessions` / `sessionProjections` 这类宿主服务，而外层上下文往往看得到。所以两侧都试，
 * 并且**把失败原因带出去** —— 上一版只返回 `undefined`，界面上只剩一句"读不到模型"，
 * 无法判断是服务不可见、会话取不到、还是投影还没有状态。
 *
 * 读不到就返回原因，由调用方回退到装载行配置或给出可读错误 —— 这里不猜一个默认模型。
 */

/** 一次模型选择（`ModelSelection` 的形状，见 `session-controller/src/types.ts` 的 zod schema）。 */
export interface ModelSelectionLike {
  /** provider 路由名。 */
  readonly provider: string
  /** 模型 id。 */
  readonly model: string
  /** 推理强度（可选；跟着会话走，免得两处不一致）。 */
  readonly reasoningEffort?: string
}

/** 查询结果：要么给出模型，要么给出卡住的原因。 */
export interface ModelLookup {
  /** 拿到的模型选择。 */
  readonly selection?: ModelSelectionLike
  /** 失败原因（直接进错误消息，便于定位）。 */
  readonly reason?: string
}

/** 投影的状态形状（只声明本模块读到的两个字段）。 */
interface ModelSelectionState {
  readonly lastUsed?: unknown
  readonly pending?: unknown
}

/** 一个只声明 `get` 的上下文（scoped 与外层都是这个形状）。 */
export interface LookupContext {
  /** 按服务名取。 */
  readonly get?: (name: string) => unknown
}

/** `sessions` 服务里用到的面。 */
interface SessionsLike {
  /** 按 id 取 Session（DSH 自己在 `session-controller/src/agent.ts:189` 就这么用）。 */
  readonly get?: (id: string) => unknown
}

/** `sessionProjections` 服务里用到的面。 */
interface ProjectionsLike {
  /** 取某个会话的某个投影状态。 */
  readonly stateOf?: (session: unknown, key: string) => unknown
}

/**
 * 把投影里的一个 selection 值收窄成 {@link ModelSelectionLike}。
 * @param value - 未知形状（可能来自另一个版本）。
 * @returns 合法时给出选择，否则 `undefined`。
 */
function narrowSelection(value: unknown): ModelSelectionLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const provider = record['provider']
  const model = record['model']
  if (typeof provider !== 'string' || provider === '') return undefined
  if (typeof model !== 'string' || model === '') return undefined
  const effort = record['reasoningEffort']
  return {
    provider,
    model,
    ...(typeof effort === 'string' && effort !== '' ? { reasoningEffort: effort } : {}),
  }
}

/**
 * 依次在多个上下文里找一个服务。
 * @param contexts - 上下文（作用域在前、外层在后）。
 * @param name - 服务名。
 * @returns 第一个非空的服务；都没有则为 `undefined`。
 */
function firstService(contexts: readonly LookupContext[], name: string): unknown {
  for (const context of contexts) {
    const value = context.get?.(name)
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

/**
 * 把会话标识截短，用于错误消息。
 *
 * sessionId 是内部标识，但它会随错误消息显示在界面上、也可能被截图带出去 —— 只留前 8 位足够
 * 定位到会话，又不至于把整串标识摊开。
 * @param id - 完整标识。
 * @returns 截短后的标识。
 */
function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`
}

/**
 * 从会话投影里读出当前模型。
 * @param contexts - 上下文列表（作用域上下文与外层上下文；顺序即优先级）。
 * @param sessionId - 目标会话。
 * @returns 模型选择，或卡住的原因。
 */
export function readSessionModel(
  contexts: readonly LookupContext[],
  sessionId: string,
): ModelLookup {
  // 兼容直接传单个上下文（运行期宽松，类型仍要求数组）。
  const list = Array.isArray(contexts) ? contexts : [contexts as LookupContext]
  const live = list.filter(context => context !== undefined && context !== null)

  const sessions = firstService(live, 'sessions') as SessionsLike | undefined
  if (sessions === undefined) return { reason: '拿不到 sessions 服务' }
  const getSession = sessions.get
  if (typeof getSession !== 'function') return { reason: 'sessions 服务没有 get(id)' }
  const session = getSession.call(sessions, sessionId)
  if (typeof session !== 'object' || session === null) {
    return { reason: `sessions.get('${shortId(sessionId)}') 没有返回会话（这个会话可能已结束）` }
  }

  let projections = firstService(live, 'sessionProjections') as ProjectionsLike | undefined
  if (projections === undefined) {
    // 兜底：投影服务可能只挂在会话作用域上（`sessions.scope(id)` 的返回值里）。真机与假上下文
    // 都可能只暴露这一条路径，所以两条都试 —— 少了它，整条链路会静默退化成"读不到模型"。
    const attachScope = (sessions as { scope?: unknown }).scope
    if (typeof attachScope === 'function') {
      const scope = (attachScope as (id: string) => Record<string, unknown> | undefined).call(sessions, sessionId)
      const attached = scope?.['sessionProjections']
      if (typeof attached === 'object' && attached !== null) projections = attached as ProjectionsLike
    }
  }
  if (projections === undefined) return { reason: '拿不到 sessionProjections 服务' }
  const stateOf = projections.stateOf
  if (typeof stateOf !== 'function') return { reason: 'sessionProjections 服务没有 stateOf(session, key)' }

  // stateOf 是宿主实现，可能抛（投影实现变更、会话归属校验等）。这里兜住并转成可读原因 ——
  // 否则异常会一路冒到路由 handler，界面上只剩 500。
  let state: ModelSelectionState | undefined
  try {
    state = stateOf.call(projections, session, 'modelSelection') as ModelSelectionState | undefined
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 120)
    return { reason: `读取会话投影时出错（${detail}）` }
  }
  if (typeof state !== 'object' || state === null) {
    // 投影是懒建的：这个会话还没成功发出过一次请求时，它还没有状态。
    return { reason: '这个会话还没有模型选择（先在本会话里发一条消息，让它跑过一轮请求）' }
  }
  const picked = narrowSelection(state.pending) ?? narrowSelection(state.lastUsed)
  return picked === undefined
    ? { reason: '投影里没有可用的 provider / model' }
    : { selection: picked }
}
