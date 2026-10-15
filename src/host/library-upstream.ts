/**
 * 提示词库路由用到的上游请求与响应工具。
 *
 * 从 `library.ts` 拆出：那里留"路由怎么注册、handler 怎么处理"，这里留"怎么打上游、失败怎么
 * 归一"。拆的直接原因是单文件行数上限（`tests/verify-install.mjs` 断言 260 行），顺带让上游
 * 交互可以单独读。
 */
import { LIBRARY_TIMEOUT_MS } from '../shared/library.js'

/**
 * 上游请求的实现。
 *
 * 抽成参数是为了可测：路由的行为（上游 URL、映射、失败归一）不该依赖真实网络。
 */
export type LibraryFetchImpl = (url: string, init: RequestInit) => Promise<Response>

/** 上游请求的结局。 */
export type UpstreamOutcome =
  | { readonly ok: true; readonly response: Response }
  | { readonly ok: false; readonly message: string; readonly status: number }

/**
 * 统一的 JSON 响应。
 * @param body - 响应体。
 * @param status - HTTP 状态码。
 * @returns 响应。
 */
export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * 带超时地请求上游。
 *
 * 超时与浏览器取消取先到者；不向上游转发任何来自浏览器的头（只发 `accept`）。
 * @param url - 完整的上游地址。
 * @param fetchImpl - 请求实现。
 * @param signal - 浏览器请求的取消信号。
 * @returns 结局；网络层失败被归一成可读说明，不作为异常抛出。
 */
export async function requestUpstream(
  url: string,
  fetchImpl: LibraryFetchImpl,
  signal: AbortSignal,
): Promise<UpstreamOutcome> {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      // 不跟随重定向：跟随就等于绕开配置里的地址（302 能把请求带去任意主机），
      // 与"基础地址只来自配置"这条边界冲突。
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(LIBRARY_TIMEOUT_MS)]),
    })
    return { ok: true, response }
  } catch (error) {
    // 浏览器已经走了：不必再回一条它读不到的响应，但仍给出结局以统一调用点。
    if (signal.aborted) return { ok: false, message: '请求已取消', status: 499 }
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      ok: false,
      message: timedOut
        ? `上游 ${LIBRARY_TIMEOUT_MS} 毫秒内没有响应`
        : `无法连接上游：${error instanceof Error ? error.message : String(error)}`,
      status: timedOut ? 504 : 502,
    }
  }
}

/**
 * 读取上游响应体里的 JSON。
 * @param response - 上游响应。
 * @returns 解析结果；不是 JSON 时给出失败说明。
 */
export async function jsonBody(
  response: Response,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  try {
    return { ok: true, body: await response.json() }
  } catch {
    return { ok: false, message: '上游响应不是 JSON' }
  }
}
