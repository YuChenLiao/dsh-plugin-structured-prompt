/**
 * 提示词库（prompts.chat）检索的共享逻辑：类型、常量与上游响应的映射。
 *
 * 这是本插件的**第二条产出路径**，与表单构建器完全分离：检索到的是别人写好的成品提示词，
 * 不进入 `PromptForm`、不做字段形状校验，只被预览与发送。因此这里不依赖任何表单类型，
 * 本插件既有的产出契约（`tests/golden/` 的 25 条样本）也不受影响。
 *
 * 上游三个只读端点（实测）：
 *  - `GET /api/prompts?perPage=N`         列表，**带 `content` 全文**
 *  - `GET /api/prompts/search?q=&limit=N` 仅按 title 匹配，**不带 `content`**
 *  - `GET /api/prompts/{id}`              单条，带 `content`
 * 界面因此走「搜索拿候选 → 按 id 取全文」两步：列表只带标题与作者，全文按需取。注意**空查询**
 * 走的是列表端点（`/api/prompts`），它每条都带全文 —— 宿主取回后只留四个字段再丢弃，因此那次
 * 响应本身并不小（实测 `perPage=10` 约 85KB）。
 */

/** 检索结果里的一条提示词（列表用，不含全文）。 */
export interface LibraryItem {
  /** 上游记录 id。 */
  readonly id: string
  /** 标题。 */
  readonly title: string
  /** 一句话描述。 */
  readonly description: string
  /** 作者名；上游不给时为空串。 */
  readonly author: string
}

/** 一条提示词的完整内容（预览与发送用）。 */
export interface LibraryDetail extends LibraryItem {
  /** 提示词正文。 */
  readonly content: string
}

/** 一次检索的结果。 */
export interface LibrarySearchResult {
  /** 命中的条目。 */
  readonly items: readonly LibraryItem[]
  /** 上游报告的总数；取不到时为 `0`（界面据此决定要不要显示"共 N 条"）。 */
  readonly total: number
  /**
   * 数据来源的展示名（通常是域名）。
   *
   * 由宿主在响应里注入：默认 `prompts.chat`，自托管时是那个实例的域名。界面据此标注来源 ——
   * 这条文案因此**跟着配置走**，而不是写死在客户端。
   */
  readonly source: string
}

/** 上游基础地址的默认值；装载行的 `config.libraryBaseUrl` 可覆盖它（自托管）。 */
export const DEFAULT_LIBRARY_BASE_URL = 'https://prompts.chat'

/** 一次检索最多返回的条数（上游 `/api/prompts/search` 的上限是 50）。 */
export const LIBRARY_MAX_LIMIT = 30

/** 界面默认取几条。 */
export const LIBRARY_DEFAULT_LIMIT = 10

/** 查询词按字符计的长度上限。 */
export const LIBRARY_MAX_QUERY_LENGTH = 120

/** 上游请求超时（毫秒）。 */
export const LIBRARY_TIMEOUT_MS = 8000

/**
 * 把条数夹到上游可接受的范围。
 * @param raw - 调用方给的条数；`undefined` 或非有限数用默认值。
 * @returns 1..{@link LIBRARY_MAX_LIMIT} 之间的整数。
 */
export function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return LIBRARY_DEFAULT_LIMIT
  const rounded = Math.trunc(raw)
  if (rounded < 1) return 1
  return rounded > LIBRARY_MAX_LIMIT ? LIBRARY_MAX_LIMIT : rounded
}

/**
 * 规范化查询词：折叠空白并截断。
 * @param raw - 原始查询词。
 * @returns 规范化后的查询词；全是空白时为空串。
 */
export function normalizeQuery(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  return collapsed.length > LIBRARY_MAX_QUERY_LENGTH
    ? collapsed.slice(0, LIBRARY_MAX_QUERY_LENGTH)
    : collapsed
}

/**
 * 上游记录 id 是否可以直接拼进 URL 路径。
 *
 * 这道校验是**安全边界**：id 由界面回传，不校验就拼进上游 URL 等于把路径注入的口子交出去
 * （`../`、`?`、`#` 都能改变实际请求的地址）。
 * @param id - 待校验的 id。
 * @returns 只含字母、数字与 `-`/`_` 且长度合理时为 `true`。
 */
export function isValidItemId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

/**
 * 取字符串字段。
 * @param value - 上游字段值。
 * @returns 字符串本身；否则空串（界面渲染空而不是 `undefined`）。
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 上游记录里的作者名。
 * @param record - 上游记录。
 * @returns 作者名；上游不给时为空串。
 */
function authorOf(record: Record<string, unknown>): string {
  const author = record['author']
  if (typeof author !== 'object' || author === null) return ''
  return text((author as Record<string, unknown>)['username'])
}

/**
 * 把上游一条记录映射成列表项。
 * @param raw - 上游记录（形状未经校验）。
 * @returns 列表项；不是对象或 `id` 不合法时为 `undefined`。
 */
export function mapItem(raw: unknown): LibraryItem | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const id = text(record['id'])
  if (!isValidItemId(id)) return undefined
  return {
    id,
    title: text(record['title']),
    description: text(record['description']),
    author: authorOf(record),
  }
}

/**
 * 把上游一条记录映射成详情。
 * @param raw - 上游记录。
 * @returns 详情；`id` 不合法或 `content` 缺失时为 `undefined`。
 */
export function mapDetail(raw: unknown): LibraryDetail | undefined {
  const item = mapItem(raw)
  if (item === undefined) return undefined
  const content = text((raw as Record<string, unknown>)['content'])
  if (content === '') return undefined
  return { ...item, content }
}

/**
 * 把上游的列表响应映射成检索结果。
 *
 * 逐条过滤而不是整份拒绝：上游里混进一条形状不对的记录，不该让整次检索失败。
 * @param raw - 上游响应体。
 * @returns 检索结果；形状完全不符时给出空结果。
 */
export function mapSearchResponse(raw: unknown): LibrarySearchResult {
  if (typeof raw !== 'object' || raw === null) return { items: [], total: 0, source: '' }
  const record = raw as Record<string, unknown>
  const list = Array.isArray(record['prompts']) ? record['prompts'] : []
  const items = list.map(mapItem).filter((item): item is LibraryItem => item !== undefined)
  const total = typeof record['total'] === 'number' && Number.isFinite(record['total'])
    ? record['total']
    : 0
  // `source` 由宿主在响应里注入（默认 `prompts.chat`，自托管时是那个实例的域名）；直接映射上游
  // 自己的响应时它不存在，于是是空串。
  return { items, total, source: text(record['source']) }
}

/** 检索弹窗里一次请求的状态。 */
export type LibraryStatus = 'idle' | 'searching' | 'ready' | 'failed'

/**
 * 提示词库弹窗的状态。
 *
 * 与表单状态并列放在 store 里，理由与 `appliedTemplate` 相同：离线渲染测试只能驱动 store，
 * 组件本地状态在 SSR 下不可观测（等于没有守护）。这里是**外部数据**（别人的提示词），
 * 因此单独成块，不与 `PromptForm` 混在一起 —— 检索结果不进入构建器。
 */
export interface LibraryState {
  /** 是否已打开检索弹窗（与表单弹窗互斥）。 */
  active: boolean
  /** 搜索框里的查询词。 */
  query: string
  /** 列表请求的状态。 */
  status: LibraryStatus
  /** 命中的条目。 */
  items: LibraryItem[]
  /** 上游报告的总数；`0` 表示未知（界面据此决定要不要显示"共 N 条"）。 */
  total: number
  /** 列表失败时的说明；成功时为空串。 */
  failure: string
  /** 当前选中的条目 id；空串表示停在列表视图。 */
  selectedId: string
  /** 选中条目的全文；未取到时为 `null`。 */
  detail: LibraryDetail | null
  /** 详情请求的状态。 */
  detailStatus: LibraryStatus
  /** 数据来源的展示名（宿主在响应里带回，如 `prompts.chat`）；未知时为空串。 */
  source: string
}

/**
 * 检索弹窗的初始状态。
 *
 * 与表单的 `createEmptyForm()` 对称：store 的初始态由这里给，避免这份字段清单在两处各写一份。
 * @returns 全新的初始状态。
 */
export function createLibraryState(): LibraryState {
  return {
    active: false,
    query: '',
    status: 'idle',
    items: [],
    total: 0,
    failure: '',
    selectedId: '',
    detail: null,
    detailStatus: 'idle',
    source: '',
  }
}
