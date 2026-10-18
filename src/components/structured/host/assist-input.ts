/**
 * 自动填充的**输入解析**：模型输出的 JSON 提取、入参收窄、父级 Session 探测。
 *
 * 从 `assist.ts` 拆出来（单文件行数上限），也因为这三件事都是**纯判断**，可以脱离网络与宿主
 * 单独断言 —— 而它们恰好是最容易静默出错的地方（提取太松会把错误藏起来、收窄漏了会让未知键
 * 混进提示词、父级判据漏了会把内部异常抛给用户）。
 */
import { FIELD_SHAPES } from '../shared/forms.js'
import type { PromptForm } from '../shared/types.js'

/**
 * 从模型输出里提取**第一个完整的** JSON 对象。
 *
 * 模型常把 JSON 包在 ```json 围栏里、或在前后加一句话；也可能先给示例、再给正式答案。
 * 所以按括号配对扫描（跳过字符串里的花括号与转义），取第一个闭合的对象 —— 而不是"第一个 `{`
 * 到最后一个 `}`"（那会把两段 JSON 拼成一段坏 JSON，报错还误导人）。
 *
 * **不做任何启发式修补**：修补过的 JSON 会把错误藏起来。
 * @param text - 模型输出。
 * @returns 解析出的对象；找不到或解析失败时为 `undefined`。
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; continue }
    if (char === '{') { depth += 1; continue }
    if (char !== '}') continue
    depth -= 1
    if (depth > 0) continue
    try {
      const parsed: unknown = JSON.parse(text.slice(start, index + 1))
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Session 的鸭子类型判据：`subagents.start` 会往父级上 `append`，所以"能 append"是最小充分特征。
 *
 * 不判这一条的话，探测可能拿回快照 / scope / 数组 —— 那时子代理启动会抛
 * `parent.append is not a function`，而这条错误会原样回给用户（等于让人看天书）。
 * @param value - 候选值。
 * @returns 是否像一个 Session。
 */
export function isSessionLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null
    && typeof (value as { append?: unknown }).append === 'function'
}

/**
 * 按 id 探测取出 Session（不同 DSH 版本的取法不同，这里逐个试）。
 *
 * 只认通过 {@link isSessionLike} 的返回值：拿不到合格的父级就返回 `undefined`，由调用方报 409
 * —— 绝不把一个"看起来非空"的对象当 Session 传下去。
 * @param ctx - 会话服务的持有者（`ctx.get('sessions')` 的来源）。
 * @param sessionId - 目标会话。
 * @returns Session；取不到时为 `undefined`。
 */
export function findSession(
  ctx: { readonly get?: (name: string) => unknown },
  sessionId: string,
): unknown {
  const sessions = ctx.get?.('sessions') as Record<string, unknown> | undefined
  if (sessions === undefined) return undefined
  for (const name of ['get', 'byId', 'find', 'resolve']) {
    const fn = sessions[name]
    if (typeof fn !== 'function') continue
    const value = (fn as (id: string) => unknown).call(sessions, sessionId)
    if (isSessionLike(value)) return value
  }
  // 会话作用域上下文上可能挂着 session 本体。
  const scope = typeof sessions['scope'] === 'function'
    ? (sessions['scope'] as (id: string) => Record<string, unknown> | undefined).call(sessions, sessionId)
    : undefined
  const owned = scope?.['session']
  if (isSessionLike(owned)) return owned
  const viaGet = typeof scope?.['get'] === 'function'
    ? (scope['get'] as (name: string) => unknown).call(scope, 'session')
    : undefined
  return isSessionLike(viaGet) ? viaGet : undefined
}

/**
 * 按 {@link FIELD_SHAPES} 的键白名单收窄入参。
 *
 * `as Partial<PromptForm>` 只是类型断言，运行期什么都不检查：不认识的键会被拼进提示词（可以
 * 伪造"已有内容"），键数也没有上限。这里按字段清单过滤 —— 顺带把"字段清单只有一份"从出参
 * 贯彻到入参。
 * @param raw - 请求里的 `current`（形状未知）。
 * @returns 只含已知字段且类型正确的部分。
 */
export function narrowCurrent(raw: unknown): Partial<PromptForm> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  const narrowed: Record<string, unknown> = {}
  for (const [key, shape] of Object.entries(FIELD_SHAPES)) {
    const value = record[key]
    if (value === undefined) continue
    if (shape === 'string[]') {
      if (Array.isArray(value) && value.every(item => typeof item === 'string')) narrowed[key] = value
      continue
    }
    if (typeof value === 'string') narrowed[key] = value
  }
  return narrowed as Partial<PromptForm>
}
