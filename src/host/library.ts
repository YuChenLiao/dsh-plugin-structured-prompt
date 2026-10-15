/**
 * 提示词库检索的同源路由（host 半边）。
 *
 * **为什么必须由宿主代发**：上游 prompts.chat 不返回 CORS 头（预检返 204，却不回
 * `Access-Control-Allow-Origin` / `Allow-Methods`），浏览器直连会被拒；宿主侧是 Node，
 * 没有这个限制。浏览器因此只请求**同源**的这条路由。副作用是好的：上游地址成了宿主侧的
 * 配置项（`config.libraryBaseUrl`），将来换自托管实例只改配置，插件代码不动。
 *
 * 安全边界（三条，都有断言守着）：
 *  1. 基础地址只来自配置，**绝不由请求参数决定** —— 否则这条路由就是一个任意 URL 代理；
 *  2. 记录 id 在拼进上游 URL 之前先按 `isValidItemId` 校验，挡掉路径注入；
 *  3. 不向上游转发任何来自浏览器的请求头（含 cookie），只发一次只读 GET，8 秒超时，
 *     并且**不跟随重定向**（`redirect: 'error'`）—— 跟出去就等于绕开配置里的地址。
 *
 * 上游请求与响应工具在 `library-upstream.ts`。
 */
import {
  DEFAULT_LIBRARY_BASE_URL,
  clampLimit,
  isValidItemId,
  mapDetail,
  mapSearchResponse,
  normalizeQuery,
} from '../shared/library.js'
import { jsonBody, jsonResponse, requestUpstream } from './library-upstream.js'
import type { LibraryFetchImpl } from './library-upstream.js'

/** 检索路由的绝对路径（`ConnectionFetchRoute.path` 含 `/api` 前缀，与既有上传路由同形）。 */
export const LIBRARY_ROUTE_PATH = '/api/structured-prompt/library'

/** 取全文的路由路径。 */
export const LIBRARY_ITEM_ROUTE_PATH = '/api/structured-prompt/library/item'

/** 本模块用到的 connection 路由注册面。 */
export interface HostConnectionFetchLike {
  /**
   * 注册一条精确 Fetch 路由。
   * @param route - 路径、方法、请求体模式与处理函数。
   * @returns 取消注册的句柄（宿主实现返回异步 disposer）。
   */
  register(route: {
    readonly path: string
    readonly methods: readonly string[]
    readonly requestBody: 'buffered' | 'streaming'
    readonly fetch: (request: Request) => Promise<Response>
  }): unknown
}

/** `ctx.get('connection')` 的最小可用形状。 */
export interface HostConnectionLike {
  /** 路由注册面；没有 web 载体的组装里缺省。 */
  readonly fetch?: HostConnectionFetchLike
}

/** 路由注册与上游请求所需的上下文面。 */
export interface LibraryRouteContext {
  /**
   * 可选读取一个服务。
   * @param name - 服务名。
   */
  get?(name: string): unknown
  /**
   * 注册一个随**当前作用域**释放的副作用。
   * @param factory - 立即执行并返回清理句柄的工厂。
   * @param label - 诊断标签。
   */
  effect?(factory: () => unknown, label: string): unknown
  /**
   * 等这些服务就绪后再执行回调，并在失去时释放该作用域上的副作用。
   * @param deps - 服务名列表。
   * @param callback - 就绪后的注册逻辑；参数是**子作用域**上下文，回调里的副作用要挂在它上面。
   */
  inject?(deps: readonly string[], callback: (scoped: LibraryRouteContext) => void): unknown
}

/** 已收窄的配置里本模块关心的部分。 */
export interface LibraryRouteConfig {
  /** 上游基础地址；未配置时用 {@link DEFAULT_LIBRARY_BASE_URL}。 */
  readonly libraryBaseUrl?: string
}

/**
 * 生效的上游基础地址。
 * @param config - 装载行配置。
 * @returns 基础地址（已去掉末尾斜杠）。
 */
export function libraryBaseUrl(config: LibraryRouteConfig | undefined): string {
  const configured = config?.libraryBaseUrl
  return configured === undefined || configured === '' ? DEFAULT_LIBRARY_BASE_URL : configured
}

/**
 * 拼一条上游地址。
 *
 * 用**相对路径**拼接（而不是 `/api/...` 这样的绝对路径）：自托管把实例挂在子路径下时
 * （`https://host/sub`），绝对路径会静默丢掉 `/sub`。
 * @param base - 基础地址。
 * @param path - 以 `api/` 开头的相对路径。
 * @returns 完整地址。
 */
function upstreamUrl(base: string, path: string): URL {
  return new URL(path, base.endsWith('/') ? base : `${base}/`)
}

/**
 * 处理一次检索请求。
 *
 * 查询词为空时列出上游最新的一批（界面上"打开就有东西可看"），否则走 title 检索。
 * @param request - 浏览器请求。
 * @param config - 装载行配置（提供基础地址）。
 * @param fetchImpl - 上游请求实现。
 * @returns JSON 响应：`{ items, total }` 或 `{ error }`。
 */
export async function handleLibrarySearch(
  request: Request,
  config: LibraryRouteConfig | undefined,
  fetchImpl: LibraryFetchImpl,
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { allow: 'GET' } })
  }
  const params = new URL(request.url).searchParams
  const query = normalizeQuery(params.get('q') ?? '')
  const limit = clampLimit(Number(params.get('limit') ?? Number.NaN))
  const base = libraryBaseUrl(config)
  const upstream = query === ''
    ? upstreamUrl(base, 'api/prompts')
    : upstreamUrl(base, 'api/prompts/search')
  if (query === '') {
    upstream.searchParams.set('perPage', String(limit))
  } else {
    upstream.searchParams.set('q', query)
    upstream.searchParams.set('limit', String(limit))
  }
  const outcome = await requestUpstream(upstream.toString(), fetchImpl, request.signal)
  if (!outcome.ok) return jsonResponse({ error: outcome.message }, outcome.status)
  // 检索这条路不做 404 特判：这里的 404 只可能是"上游没有这个端点"（自托管版本或子路径配错），
  // 说成"没有这条提示词"会把人带偏 —— 特判只属于取全文那条路由。
  if (!outcome.response.ok) {
    return jsonResponse({ error: `上游返回 ${outcome.response.status}` }, 502)
  }
  const parsed = await jsonBody(outcome.response)
  if (!parsed.ok) return jsonResponse({ error: parsed.message }, 502)
  return jsonResponse(mapSearchResponse(parsed.body), 200)
}

/**
 * 处理一次"取全文"请求。
 * @param request - 浏览器请求。
 * @param config - 装载行配置（提供基础地址）。
 * @param fetchImpl - 上游请求实现。
 * @returns JSON 响应：`{ item }` 或 `{ error }`。
 */
export async function handleLibraryItem(
  request: Request,
  config: LibraryRouteConfig | undefined,
  fetchImpl: LibraryFetchImpl,
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { allow: 'GET' } })
  }
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!isValidItemId(id)) return jsonResponse({ error: 'id 不合法' }, 400)
  const upstream = upstreamUrl(libraryBaseUrl(config), `api/prompts/${id}`)
  const outcome = await requestUpstream(upstream.toString(), fetchImpl, request.signal)
  if (!outcome.ok) return jsonResponse({ error: outcome.message }, outcome.status)
  if (!outcome.response.ok) {
    // 这条路上 404 的含义是明确的：记录没了。它与"上游挂了"（502）该是两句话。
    if (outcome.response.status === 404) {
      return jsonResponse({ error: '上游没有这条提示词' }, 404)
    }
    return jsonResponse({ error: `上游返回 ${outcome.response.status}` }, 502)
  }
  const parsed = await jsonBody(outcome.response)
  if (!parsed.ok) return jsonResponse({ error: parsed.message }, 502)
  const detail = mapDetail(parsed.body)
  // 上游 2xx 但记录里没有正文：这属于"上游给的东西不合预期"，不是"没有这条记录"。
  if (detail === undefined) return jsonResponse({ error: '上游返回的记录缺少正文' }, 502)
  return jsonResponse({ item: detail }, 200)
}

/**
 * 注册提示词库的两条只读路由。
 *
 * **注册必须走 `ctx.inject`，不能在 `apply` 期用 `ctx.get` 读一次**：加载器的 entry 是
 * **并行**创建的（`vendor/loader/src/config/group.ts` 的 `Promise.allSettled`），各 entry 的
 * `apply` 先后没有保证；而 `connection` 的 fiber 要等 `credentials`，依赖链比本插件的 `tools`
 * 长 —— 在 `apply` 期读一次很可能读到"还没就绪"，然后**永久**跳过注册、且没有任何报错
 * （浏览器那边只看到共享通道的 404）。DSH 自己的 web 载体注册也是这么做的
 * （`packages/client/modules` 里的 `ctx.inject(['webServer'], registerWebCarrier)`）。
 *
 * 回调**必须用它的参数作用域**（`scoped`）来读服务与挂副作用：`ctx.inject` 的回调运行在新建
 * 的子 fiber 上，副作用挂在子 fiber 才会"依赖失去时释放"；挂在外层 ctx 上只有插件卸载时才释放。
 *
 * 没有 `connection`（该组装没有 web 载体）时不注册任何东西 —— 那是设计内的降级；缺少
 * `inject` / `effect` 面则属于异常组装，留一条日志而不是静默跳过。
 * @param ctx - host 侧插件上下文。
 * @param config - 装载行配置。
 * @param deps - 可注入的上游请求实现（测试用）。
 */
export function registerLibraryRoute(
  ctx: LibraryRouteContext,
  config: LibraryRouteConfig | undefined,
  deps?: { readonly fetchImpl?: LibraryFetchImpl },
): void {
  if (typeof ctx.inject !== 'function') {
    console.warn('[structured-prompt] 提示词库路由未注册：host 上下文没有 ctx.inject 面')
    return
  }
  const fetchImpl: LibraryFetchImpl = deps?.fetchImpl ?? ((url, init) => fetch(url, init))
  /**
   * 构造一条只读路由。
   * @param path - 绝对路径。
   * @param handler - 处理函数。
   * @returns 路由描述。
   */
  const route = (path: string, handler: (request: Request) => Promise<Response>) => ({
    path,
    methods: ['GET'] as const,
    requestBody: 'buffered' as const,
    fetch: (request: Request) => handler(request),
  })
  ctx.inject(['connection'], (scoped) => {
    const fetchFace = (scoped.get?.('connection') as HostConnectionLike | undefined)?.fetch
    const register = fetchFace?.register
    if (register === undefined || fetchFace === undefined) return
    if (typeof scoped.effect !== 'function') {
      console.warn('[structured-prompt] 提示词库路由未注册：connection 就绪了，但作用域没有 ctx.effect 面')
      return
    }
    scoped.effect(
      () => register.call(fetchFace, route(
        LIBRARY_ROUTE_PATH,
        request => handleLibrarySearch(request, config, fetchImpl),
      )),
      'structured-prompt: library search route',
    )
    scoped.effect(
      () => register.call(fetchFace, route(
        LIBRARY_ITEM_ROUTE_PATH,
        request => handleLibraryItem(request, config, fetchImpl),
      )),
      'structured-prompt: library item route',
    )
  })
}
