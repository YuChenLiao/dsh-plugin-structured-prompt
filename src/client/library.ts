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
  mapItem,
  type LibraryDetail,
  type LibraryItem,
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
    // 宿主没有这条路由时返回的是共享通道的纯文本 404（不是我们那两条路由的 JSON）。最可能的
    // 原因是 host 半边刚改过而 DSH 还没重启 —— host 侧的路由注册发生在启动时，而客户端 bundle
    // 会在页面刷新时重新取，所以"界面是新的、路由是旧的"完全可能。
    return {
      ok: false,
      error: response.status === 404
        ? '宿主没有这条检索路由：host 侧的改动要重启 DSH 才生效'
        : `宿主的响应不是 JSON（HTTP ${response.status}）`,
    }
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
/**
 * 把**宿主**的检索响应收敛成稳定形状。
 *
 * 收敛的是宿主的形状（`{ items, total, source }`），逐条过 `mapItem`。这里曾经写成
 * `mapSearchResponse`（那是给**上游**的 `{ prompts: [...] }` 用的），于是 `prompts` 永远不存在、
 * 每次检索都被缩成空列表 —— 宿主与界面各自都对，错在中间这一层拿错了函数。
 *
 * 形状漂移要**说出来**而不是静默给空列表：那会让人以为是"没有结果"，与"没命中"混为一谈。
 * @param raw - 宿主的响应体（形状未经校验）。
 * @returns 收敛结果。
 */
export function toSearchResult(raw: unknown): LibraryResult<LibrarySearchResult> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '宿主的响应不是对象' }
  }
  const body = raw as { items?: unknown; total?: unknown; source?: unknown }
  if (!Array.isArray(body.items)) {
    return { ok: false, error: '宿主的响应形状不对：缺少 items 列表' }
  }
  const items = body.items.map(mapItem).filter((item): item is LibraryItem => item !== undefined)
  // `total` 取不到时给 `0`（"未知"），与宿主侧的兜底保持一致 —— 两处不同会让将来的读者误判。
  const total = typeof body.total === 'number' && Number.isFinite(body.total) ? body.total : 0
  const source = typeof body.source === 'string' ? body.source : ''
  return { ok: true, value: { items, total, source } }
}

/**
 * 一次成功的检索结果 → store 的 patch。
 *
 * 抽成纯函数是为了让"响应里的 `source` 真的被写进 store"这一步有断言守着：这一步夹在
 * `searchLibrary` 的返回值与组件的 `patchLibrary` 之间，渲染测试驱动 store、抓不到它。
 * @param result - 收敛后的检索结果。
 * @returns store 的 patch。
 */
export function searchPatch(result: LibrarySearchResult): {
  readonly status: 'ready'
  readonly items: LibraryItem[]
  readonly total: number
  readonly source: string
} {
  return { status: 'ready', items: [...result.items], total: result.total, source: result.source }
}

/**
 * 检索提示词库。
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
  return toSearchResult(result.value)
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
