/**
 * 提示词库组件的装载行配置（`cordis.patch.yml` 里 `library` 那条装载行的 `config`）。
 *
 * 与结构化组件分开：这一条只认 `libraryBaseUrl`，因此"指向自托管实例"是**这个组件自己的**
 * 部署选择，与子代理 provider 无关。
 *
 * 校验逻辑同 `components/structured/host/config.ts`：手写 standard-schema，零 import。
 */

/** 提示词库组件的配置。 */
export interface LibraryPluginConfig {
  /**
   * 提示词库的基础地址。
   *
   * 检索请求由**宿主**代发（上游不返回 CORS 头，浏览器直连会被拒），所以地址是宿主侧的事：
   * 想指向自托管实例就在这里写，组件代码一行不用动。缺省用 `https://prompts.chat`。
   */
  readonly libraryBaseUrl?: string
}

/** 配置里允许出现的字段。 */
const CONFIG_FIELDS = ['libraryBaseUrl'] as const

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
 * 用 `new URL` 判而不是正则：`https://` 拼不出地址，`https://host@evil.example` 的 origin 其实是
 * `evil.example`，带 query/fragment 的写法会静默改掉拼出来的路径 —— 这些笔误在装载期就该报出来。
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
  if (parsed.search !== '' || parsed.hash !== '') {
    return 'config.libraryBaseUrl must not carry a query or fragment'
  }
  return undefined
}

/**
 * 收集配置的问题说明。
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
  const baseUrl = record['libraryBaseUrl']
  if (baseUrl !== undefined && baseUrl !== null && typeof baseUrl !== 'string') {
    problems.push('config.libraryBaseUrl must be a string')
  }
  const text = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  if (text !== '') {
    const problem = baseUrlProblem(text)
    if (problem !== undefined) problems.push(problem)
  }
  return problems
}

/**
 * 收窄装载行里的 `config`。
 * @param raw - 装载行的 `config`；未写时为 `undefined`。
 * @returns 收窄后的配置；未配置（含 YAML 空值）时为空对象。
 * @throws {Error} 形状不合法时；问题说明与 `Config` 报的同源。
 */
export function narrowConfig(raw: unknown): LibraryPluginConfig {
  const problems = configProblems(raw)
  if (problems.length > 0) {
    throw new Error(`prompt-library: invalid config — ${problems.join('; ')}`)
  }
  if (typeof raw !== 'object' || raw === null) return {}
  const value = (raw as Record<string, unknown>)['libraryBaseUrl']
  if (typeof value !== 'string') return {}
  // 尾斜杠去掉：`new URL('api/...', base)` 两种写法都能工作，但收窄成一种，显示与比对时才不会
  // 因为写法不同而像是两个配置。空串与纯空白按「没配」处理。
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed === '' ? {} : { libraryBaseUrl: trimmed }
}

/**
 * 装载行配置的 schema（standard-schema 形状，手写）。
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-plugin-structured-prompt-library',
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
