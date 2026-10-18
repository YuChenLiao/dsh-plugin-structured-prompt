/**
 * 自动扩写填表（client 半边）：把一句话需求发给宿主，拿回字段补丁。
 *
 * 请求走**同源**路径（宿主注册的路由），所以浏览器不需要知道子代理、模型或会话是怎么接的。
 * 补丁由调用方填进表单；本模块不碰 store，也不做校验 —— 校验在宿主侧已经做过一遍
 * （`parseFormDocument`），这里只是搬运。
 */
import type { PromptForm } from '../shared/types.js'

/** 同源路径（与宿主的 `ASSIST_ROUTE_PATH` 必须一致，由测试交叉断言）。 */
export const ASSIST_PATH = '/api/structured-prompt/assist'

/**
 * 客户端等待上限。
 *
 * 比宿主的 90 秒再宽一点：宿主自己会在 90 秒处给出"超时"的结构化错误，客户端只需要兜住
 * "宿主整个没回话"这种更糟的情况。
 */
const CLIENT_TIMEOUT_MS = 95_000

/** 一次扩写的结果。 */
export interface AssistResult {
  /** 可落进表单的增量补丁。 */
  readonly patch: Partial<PromptForm>
  /** 校验时被丢弃/改写的内容说明。 */
  readonly warnings: readonly string[]
  /** 实际使用的子代理 provider 名。 */
  readonly provider: string
}

/** 结果包装：成功给值，失败给可展示的说明。 */
export type AssistOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

/** 可注入的请求实现（离线测试用）。 */
export interface AssistDeps {
  /** `fetch` 的替身。 */
  readonly fetchImpl?: typeof fetch
}

/**
 * 请宿主跑一次扩写。
 * @param brief - 用户的一句话需求。
 * @param current - 表单里已填的字段（宿主会转给子代理，避免覆盖用户内容）。
 * @param sessionId - 当前会话（子代理需要一个父级会话）。
 * @param deps - 可注入的请求实现。
 * @returns 补丁，或可展示的失败原因。
 */
export async function requestAssist(
  brief: string,
  current: Partial<PromptForm>,
  sessionId: string,
  deps?: AssistDeps,
): Promise<AssistOutcome<AssistResult>> {
  const fetchImpl = deps?.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(ASSIST_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ brief, current, sessionId }),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      ok: false,
      error: timedOut
        ? `宿主在 ${CLIENT_TIMEOUT_MS / 1000} 秒内没有响应（子代理可能还在跑）`
        : `无法连接宿主：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    // 宿主没注册这条路由时返回的是共享通道的纯文本 404 —— 典型原因是 host 侧改动还没重启。
    return {
      ok: false,
      error: response.status === 404
        ? '宿主没有这条自动填充路由：host 侧的改动要重启 DSH 才生效'
        : `宿主的响应不是 JSON（HTTP ${response.status}）`,
    }
  }

  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  if (!response.ok) {
    const reported = record['error']
    return { ok: false, error: typeof reported === 'string' && reported !== '' ? reported : `HTTP ${response.status}` }
  }
  const patch = record['patch']
  if (typeof patch !== 'object' || patch === null) {
    return { ok: false, error: '宿主的响应里没有补丁' }
  }
  const warnings = Array.isArray(record['warnings'])
    ? record['warnings'].filter((item): item is string => typeof item === 'string')
    : []
  return {
    ok: true,
    value: {
      patch: patch as Partial<PromptForm>,
      warnings,
      provider: typeof record['provider'] === 'string' ? record['provider'] : '',
    },
  }
}
