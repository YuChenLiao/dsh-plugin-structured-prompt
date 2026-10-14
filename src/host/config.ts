/**
 * host 半边的插件配置（来自 `cordis.patch.yml` 装载行的 `config`）。
 *
 * 配置校验交给 cordis：本模块导出 {@link Config}（standard-schema 的形状），而 cordis 只在
 * 插件导出 `Config` 时才校验配置 —— 形状不对会在**装载期**抛 `ValidationError` 并列出问题，
 * 插件不必自己抛。
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
  const unsupported = Object.keys(record).filter(key => key !== 'provider')
  if (unsupported.length > 0) {
    problems.push(`unsupported config field(s): ${unsupported.join(', ')}`)
  }
  const provider = record['provider']
  // YAML 里写 `provider:`（空值）解析成 `null`，与"没写"同义，不算类型错误。
  if (provider !== undefined && provider !== null && typeof provider !== 'string') {
    problems.push('config.provider must be a string')
  }
  return problems
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
  const provider = (raw as Record<string, unknown>)['provider']
  if (typeof provider !== 'string') return {}
  // 空串与纯空白按「没配」处理，与参数边界的「空串算未给」保持一致。
  const trimmed = provider.trim()
  return trimmed === '' ? {} : { provider: trimmed }
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
