/**
 * 提示词库检索的客户端。
 *
 * 只依赖 `fetch` 与**同源**路径：上游 prompts.chat 不返回 CORS 头（预检返 204 却不回
 * `Access-Control-Allow-Origin`），浏览器直连会被拒；所以这里请求的是宿主注册的两条路由
 * （见 `src/host/library.ts`），由宿主代发。本模块因此**不认识上游地址** —— 那属于宿主侧
 * 的配置（`config.libraryBaseUrl`），将来换自托管实例与本模块无关。
 */
import {
  LIBRARY_DEFAULT_LIMIT,
  mapDetail,
  mapSearchResponse,
  type LibraryDetail,
  type LibrarySearchResult,
} from '../shared/library.js'

/** 检索路由路径（与 `src/host/library.ts` 的常量成对）。 */
export const LIBRARY_SEARCH_PATH = '/api/structured-prompt/library'

/** 取全文的路由路径。 */
export const LIBRARY_ITEM_PATH = '/api/structured-prompt/library/item'

/**
 * 客户端等待上限：比宿主侧的上游超时（8 秒）略长，好让宿主给出的错误说明先到，
 * 而不是客户端先抛一个没有信息的取消。
 */
const CLIENT_TIMEOUT_MS = 12000

/** 一次请求的结局。 */
export type LibraryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

/** 可注入的依赖（测试用假实现；生产走全局 `fetch`）。 */
export interface LibraryClientDeps {
  /** 请求实现。 */
  readonly fetchImpl?: typeof fetch
}

/**
 * 请求一条同源路由并解析 JSON。
 *
 * 失败一律归一成**可显示的说明**：宿主在响应体里给 `error` 字段时优先用它（那里写着上游
 * 到底怎么了 —— 超时、上游状态码、还是没这条记录）。
 * @param url - 同源路径（可带查询串）。
 * @param deps - 可注入的请求实现。
 * @returns 结局。
 */
async function requestJson(
  url: string,
  deps: LibraryClientDeps | undefined,
): Promise<LibraryResult<unknown>> {
  const fetchImpl = deps?.fetchImpl
    ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
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
    return { ok: false, error: `宿主的响应不是 JSON（HTTP ${response.status}）` }
  }
  if (!response.ok) {
    const reported = typeof body === 'object' && body !== null
      ? (body as { error?: unknown }).error
      : undefined
    return {
      ok: false,
      error: typeof reported === 'string' && reported !== '' ? reported : `HTTP ${response.status}`,
    }
  }
  return { ok: true, value: body }
}

/**
 * 检索提示词库。
 *
 * 宿主已经把上游响应映射过一次；这里**再收敛一次**是廉价的防御 —— 界面拿到的形状因此
 * 与宿主的版本无关，上游或宿主任何一侧改了字段都不会让渲染崩掉。
 * @param query - 查询词；空串表示列上游最新的一批。
 * @param deps - 可注入的请求实现。
 * @returns 命中条目；失败时给出可显示的说明。
 */
export async function searchLibrary(
  query: string,
  deps?: LibraryClientDeps,
): Promise<LibraryResult<LibrarySearchResult>> {
  const params = new URLSearchParams({ q: query, limit: String(LIBRARY_DEFAULT_LIMIT) })
  const result = await requestJson(`${LIBRARY_SEARCH_PATH}?${params.toString()}`, deps)
  if (!result.ok) return result
  return { ok: true, value: mapSearchResponse(result.value) }
}

/**
 * 取一条提示词的全文。
 * @param id - 条目的 id（宿主会再校验一次，见 `isValidItemId`）。
 * @param deps - 可注入的请求实现。
 * @returns 全文；上游没有这条记录时给出说明。
 */
export async function fetchLibraryDetail(
  id: string,
  deps?: LibraryClientDeps,
): Promise<LibraryResult<LibraryDetail>> {
  const result = await requestJson(`${LIBRARY_ITEM_PATH}?id=${encodeURIComponent(id)}`, deps)
  if (!result.ok) return result
  const wrapped = typeof result.value === 'object' && result.value !== null
    ? (result.value as { item?: unknown }).item
    : undefined
  const detail = mapDetail(wrapped)
  return detail === undefined
    ? { ok: false, error: '响应里没有这条提示词' }
    : { ok: true, value: detail }
}
