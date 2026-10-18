/**
 * 读出「当前对话正在用的模型」。
 *
 * 自动填充不要求用户配置模型：它**继承当前对话的模型**。DSH 把这件事记在会话投影里
 * （`packages/api/session-controller/src/model-selection-projection.ts`）：
 *
 *  - key 是 `'modelSelection'`，state 形如 `{ lastUsed, pending }`：
 *    - `lastUsed` 来自最近一次 `request/header` 事件的 `config`（**真正用过**的模型）；
 *    - `pending` 是使用者刚切换、尚未生效的选择。
 *  - 所以 `pending ?? lastUsed` = "下一次请求会用的模型"，正合"继承当前对话"的直觉。
 *
 * 读不到就返回 `undefined`，由调用方回退到装载行配置或给出可读错误 —— 这里不猜一个默认模型。
 */
import { findSession } from './assist-input.js'

/** 一次模型选择（`ModelSelection` 的形状，见 `session-controller/src/types.ts` 的 zod schema）。 */
export interface ModelSelectionLike {
  /** provider 路由名。 */
  readonly provider: string
  /** 模型 id。 */
  readonly model: string
  /** 推理强度（可选；跟着会话走，免得两处不一致）。 */
  readonly reasoningEffort?: string
}

/** 投影的状态形状（只声明本模块读到的两个字段）。 */
interface ModelSelectionState {
  readonly lastUsed?: unknown
  readonly pending?: unknown
}

/** `sessionProjections` 服务里用到的面。 */
interface ProjectionsLike {
  readonly stateOf?: (session: unknown, key: string) => unknown
}

/** 会话服务的面（只需要 `scope`：作用域上下文上可能挂着投影服务）。 */
interface SessionsLike {
  readonly scope?: (id: string) => Record<string, unknown> | undefined
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
 * 从会话投影里读出当前模型。
 *
 * 两条取投影的路径都试（作用域上下文 / 全局上下文）—— 不同组装里服务的可见范围不同，
 * 而这一步失败只会降级到配置，不会让功能不可用。
 * @param ctx - host 上下文。
 * @param sessionId - 目标会话。
 * @returns 当前会话的模型；读不到时为 `undefined`。
 */
export function readSessionModel(
  ctx: { readonly get?: (name: string) => unknown },
  sessionId: string,
): ModelSelectionLike | undefined {
  const session = findSession(ctx, sessionId)
  if (session === undefined) return undefined

  const sessions = ctx.get?.('sessions') as SessionsLike | undefined
  const scoped = sessions?.scope?.(sessionId)
  const candidates: unknown[] = [
    (scoped?.['get'] as ((name: string) => unknown) | undefined)?.call(scoped, 'sessionProjections'),
    ctx.get?.('sessionProjections'),
    scoped?.['sessionProjections'],
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const stateOf = (candidate as ProjectionsLike).stateOf
    if (typeof stateOf !== 'function') continue
    const state = stateOf.call(candidate, session, 'modelSelection') as ModelSelectionState | undefined
    if (typeof state !== 'object' || state === null) continue
    // `pending` 优先：那是"下一次请求会用到的"选择。
    const picked = narrowSelection(state.pending) ?? narrowSelection(state.lastUsed)
    if (picked !== undefined) return picked
  }
  return undefined
}
