/**
 * 「任务扩写」的客户端调用：把输入框里的一句话发给宿主，拿回一段可直接发送的正文。
 *
 * 与自动填充的区别只在产物：那边拿字段补丁、进表单；这边拿纯文本、回填输入框。
 */
import type { AssistOutcome } from './assist.js'

/** 同源路径（与宿主的 `TASK_ROUTE_PATH` 必须一致，由测试交叉断言）。 */
export const TASK_PATH = '/api/structured-prompt/expand-task'

/** 客户端等待上限（比宿主宽一点，兜住"宿主整个没回话"）。 */
const CLIENT_TIMEOUT_MS = 95_000

/** 一次扩写的结果。 */
export interface TaskRewriteResult {
  /** 可直接填进输入框的正文。 */
  readonly text: string
  /** 实际走的标识。 */
  readonly provider: string
  /** 走的哪条路径。 */
  readonly via: 'llm' | 'subagent' | ''
}

/** 可注入的请求实现（离线测试用）。 */
export interface TaskRewriteDeps {
  /** `fetch` 的替身。 */
  readonly fetchImpl?: typeof fetch
}

/**
 * 请宿主把这句话扩写成完整任务。
 * @param task - 输入框里的原文。
 * @param sessionId - 当前会话（模型从会话继承）。
 * @param deps - 可注入的请求实现。
 * @returns 正文，或可展示的失败原因。
 */
export async function requestRewrite(
  task: string,
  sessionId: string,
  deps?: TaskRewriteDeps,
): Promise<AssistOutcome<TaskRewriteResult>> {
  const fetchImpl = deps?.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(TASK_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ task, sessionId }),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      ok: false,
      error: timedOut
        ? `宿主在 ${CLIENT_TIMEOUT_MS / 1000} 秒内没有响应`
        : `无法连接宿主：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return {
      ok: false,
      error: response.status === 404
        ? '宿主没有这条任务扩写路由：host 侧的改动要重启 DSH 才生效'
        : `宿主的响应不是 JSON（HTTP ${response.status}）`,
    }
  }
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  if (!response.ok) {
    const reported = record['error']
    return {
      ok: false,
      error: typeof reported === 'string' && reported !== '' ? reported : `HTTP ${response.status}`,
    }
  }
  const text = record['text']
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: '宿主的响应里没有可填入的正文' }
  }
  return {
    ok: true,
    value: {
      text,
      provider: typeof record['provider'] === 'string' ? record['provider'] : '',
      via: record['via'] === 'llm' || record['via'] === 'subagent' ? record['via'] : '',
    },
  }
}
