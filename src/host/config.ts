/**
 * host 半边的插件配置（来自 `cordis.patch.yml` 装载行的 `config`）。
 *
 * 配置校验交给 cordis：本模块导出 {@link Config}（standard-schema 的形状），而 cordis 只在
 * 插件导出 `Config` 时才校验配置（`vendor/cordis/src/fiber.ts` 的 `resolveConfig`：没有
 * `Config` 就把 config 原样交给 `apply`）—— 形状不对会在**装载期**抛 `ValidationError` 并列出
 * 问题，插件不必自己抛。
 *
 * `Config` 是**手写**的，没有 import 任何校验库：它的接口就是一个 `{ '~standard': { validate } }`
 * 对象，而本插件的 host 产物必须零运行时 import（`link:` 安装下 ESM 会 realpath 到源码目录，
 * 那里没有任何 node_modules）。校验逻辑只有一份 —— `Config` 与 `narrowConfig` 都走
 * {@link configProblems}。
 */

/** host 半边的配置。 */
export interface HostPluginConfig {
  /**
   * 默认的子代理 provider 名。
   *
   * 部署级选择：DSH 的 base bundle 同时注册 `spawn` 与 `fork`，装第三方 provider 的 profile
   * 还会有别的候选。只在需要改变默认时才写它；调用参数 `delegate.provider` 优先于它。
   */
  readonly provider?: string
  /**
   * 提示词库（prompts.chat）的基础地址。
   *
   * 检索请求由**宿主**代发（上游不返回 CORS 头，浏览器直连会被拒），所以这个地址是宿主侧
   * 的事：想指向自托管实例就在这里写，插件代码一行不用动。缺省用 `https://prompts.chat`。
   */
  readonly libraryBaseUrl?: string
}

/** 配置里允许出现的字段（不在其中的字段在装载期报错，而不是被静默忽略）。 */
const CONFIG_FIELDS = ['provider', 'libraryBaseUrl'] as const

/**
 * 解析一个绝对 URL。
 * @param value - 待解析的字符串。
 * @returns URL；解析失败时为 `undefined`。
 */
function parseAbsoluteUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/**
 * 基础地址的问题说明。
 *
 * 用 `new URL` 判而不是正则：`https://` 拼不出地址，而 `https://host@evil.example` 的
 * origin 其实是 `evil.example` —— 这两种笔误在装载期就该报出来，不该拖到第一次检索。
 * @param value - 去空白后的基础地址。
 * @returns 问题说明；合法时为 `undefined`。
 */
function baseUrlProblem(value: string): string | undefined {
  const parsed = parseAbsoluteUrl(value)
  if (parsed === undefined) return 'config.libraryBaseUrl must be a valid absolute URL'
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'config.libraryBaseUrl must use http:// or https://'
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return 'config.libraryBaseUrl must not carry credentials'
  }
  if (parsed.hostname === '') return 'config.libraryBaseUrl must include a host'
  // 带 query 或 fragment 的写法会静默改变拼出来的上游地址（`https://host/sub?x=1` 拼出来是
  // `https://host/api/prompts?x=1`，`/sub` 没了），所以在这里拒掉。
  if (parsed.search !== '' || parsed.hash !== '') {
    return 'config.libraryBaseUrl must not carry a query or fragment'
  }
  return undefined
}

/**
 * 收集配置的问题说明。
 *
 * `Config` 与 `narrowConfig` 共用它：一处判定、两种呈现（装载期 issue 列表 / 直接抛错），
 * 否则两条路径迟早会分叉。
 * @param raw - 装载行的 `config`；未写时为 `undefined`。
 * @returns 问题说明；空数组表示合法。
 */
function configProblems(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  if (typeof raw !== 'object' || Array.isArray(raw)) return ['config must be an object']
  const record = raw as Record<string, unknown>
  const problems: string[] = []
  const unsupported = Object.keys(record)
    .filter(key => !(CONFIG_FIELDS as readonly string[]).includes(key))
  if (unsupported.length > 0) {
    problems.push(`unsupported config field(s): ${unsupported.join(', ')}`)
  }
  for (const key of CONFIG_FIELDS) {
    const value = record[key]
    // YAML 里写 `provider:`（空值）解析成 `null`，与"没写"同义，不算类型错误。
    if (value !== undefined && value !== null && typeof value !== 'string') {
      problems.push(`config.${key} must be a string`)
    }
  }
  const baseUrl = typeof record['libraryBaseUrl'] === 'string' ? record['libraryBaseUrl'].trim() : ''
  if (baseUrl !== '') {
    const problem = baseUrlProblem(baseUrl)
    if (problem !== undefined) problems.push(problem)
  }
  return problems
}

/**
 * 取一个字符串配置项。
 * @param record - 装载行的 `config`。
 * @param key - 字段名。
 * @returns 去首尾空白后的值；未配置、非字符串或纯空白时为空串。
 */
function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 收窄装载行里的 `config`。
 * @param raw - `cordis.patch.yml` 里该装载行的 `config`；未写时为 `undefined`。
 * @returns 收窄后的配置；未配置（含 YAML 空值）时为空对象，等价于"用内建默认策略"。
 * @throws {Error} 形状不合法时；问题说明与 `Config` 报的同源。
 */
export function narrowConfig(raw: unknown): HostPluginConfig {
  const problems = configProblems(raw)
  if (problems.length > 0) {
    throw new Error(`structured-prompt: invalid config — ${problems.join('; ')}`)
  }
  if (typeof raw !== 'object' || raw === null) return {}
  const record = raw as Record<string, unknown>
  const provider = stringField(record, 'provider')
  // 尾斜杠去掉：`new URL('/api/...', base)` 两种写法都能工作，但收窄成一种，
  // 显示与比对时才不会因为写法不同而像是两个配置。
  const libraryBaseUrl = stringField(record, 'libraryBaseUrl').replace(/\/+$/, '')
  return {
    // 空串与纯空白按「没配」处理，与参数边界的「空串算未给」保持一致。
    ...(provider === '' ? {} : { provider }),
    ...(libraryBaseUrl === '' ? {} : { libraryBaseUrl }),
  }
}

/**
 * 装载行配置的 schema（standard-schema 形状，手写）。
 *
 * cordis 的 `resolveConfig` 只消费 `Config['~standard'].validate(config)`：返回 `{ value }`
 * 就用它替换原始 config，返回 `{ issues }` 就在装载期抛 `ValidationError`，`apply` 根本不会
 * 被调用。因此这里返回的是**收窄后**的配置，`apply` 拿到的已经是规范值。
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-plugin-structured-prompt',
    /**
     * 校验并规范化装载行配置。
     * @param value - 装载行的 `config`；未写时为 `undefined`。
     * @returns 合法时给出收窄后的配置，否则给出问题列表。
     */
    validate(value: unknown) {
      const problems = configProblems(value)
      return problems.length > 0
        ? { issues: problems.map(message => ({ message })) }
        : { value: narrowConfig(value) }
    },
  },
} as const
