/**
 * 结构化提示词组件的装载行配置（`cordis.patch.yml` 里那条装载行的 `config`）。
 *
 * 组件拆分把配置也按组件切开：本文件只管结构化组件，提示词库的地址在
 * `components/library/host/config.ts` 里 —— 两者不再挤在同一份配置对象里。
 *
 * 三个字段分两类：
 *  - `provider` —— **子代理**的 provider 名（自动填充的回退路径、以及工具 `delegate` 的默认值）；
 *  - `assistProvider` / `assistModel` —— **单次调用**路径的模型路由。两个都配了才走单次调用
 *    （DSH 的 `GenerateOptions` 里 provider 与 model 都是必填、无默认值），否则回退到子代理。
 *
 * 配置校验交给 cordis：本模块导出 {@link Config}（standard-schema 的形状），而 cordis 只在插件
 * 导出 `Config` 时才校验配置（`vendor/cordis/src/fiber.ts` 的 `resolveConfig`：没有 `Config` 就把
 * config 原样交给 `apply`）—— 形状不对会在**装载期**抛 `ValidationError` 并列出问题。
 *
 * `Config` 是**手写**的，没有 import 任何校验库：本插件的 host 产物必须零运行时 import（`link:`
 * 安装下 ESM 会 realpath 到源码目录，那里没有任何 node_modules）。校验只有一份 —— `Config` 与
 * `narrowConfig` 都走 {@link configProblems}。
 */

/** 结构化提示词组件的配置。 */
export interface StructuredPluginConfig {
  /**
   * 默认的子代理 provider 名。
   *
   * 部署级选择：DSH 的 base bundle 同时注册 `spawn` 与 `fork`，装第三方 provider 的 profile
   * 还会有别的候选。只在需要改变默认时才写它；调用参数 `delegate.provider` 优先于它。
   */
  readonly provider?: string
  /**
   * 自动填充走「单次调用」时的模型路由（如 `deepseek`）。
   *
   * 与 `provider` **不共用**：那个是子代理的 provider 名，这个是 llm 服务的路由名。
   * `assistProvider` 与 `assistModel` 都配了才走单次调用；缺一个就回退到子代理路径。
   */
  readonly assistProvider?: string
  /** 自动填充走「单次调用」时的模型名（与 `assistProvider` 同时配置才生效）。 */
  readonly assistModel?: string
}

/** 配置里允许出现的字段（不在其中的字段在装载期报错，而不是被静默忽略）。 */
const CONFIG_FIELDS = ['provider', 'assistProvider', 'assistModel'] as const

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
    // YAML 里写 `key:`（空值）解析成 `null`，与"没写"同义，不算类型错误。
    if (value !== undefined && value !== null && typeof value !== 'string') {
      problems.push(`config.${key} must be a string`)
    }
  }
  // 只配一半是配置错误，而不是"静默用单次调用的半个参数"：两个都得给，或者都不给。
  const hasProvider = typeof record['assistProvider'] === 'string'
    && (record['assistProvider'] as string).trim() !== ''
  const hasModel = typeof record['assistModel'] === 'string'
    && (record['assistModel'] as string).trim() !== ''
  if (hasProvider !== hasModel) {
    problems.push('config.assistProvider 与 config.assistModel 必须同时配置')
  }
  return problems
}

/**
 * 收窄装载行里的 `config`。
 * @param raw - 装载行的 `config`；未写时为 `undefined`。
 * @returns 收窄后的配置；未配置（含 YAML 空值）时为空对象，等价于"用内建默认策略"。
 * @throws {Error} 形状不合法时；问题说明与 `Config` 报的同源。
 */
export function narrowConfig(raw: unknown): StructuredPluginConfig {
  const problems = configProblems(raw)
  if (problems.length > 0) {
    throw new Error(`structured-prompt: invalid config — ${problems.join('; ')}`)
  }
  if (typeof raw !== 'object' || raw === null) return {}
  const record = raw as Record<string, unknown>
  // 空串与纯空白按「没配」处理，与参数边界的「空串算未给」保持一致。
  const text = (key: string): string | undefined => {
    const value = record[key]
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  const provider = text('provider')
  const assistProvider = text('assistProvider')
  const assistModel = text('assistModel')
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(assistProvider === undefined ? {} : { assistProvider }),
    ...(assistModel === undefined ? {} : { assistModel }),
  }
}

/**
 * 装载行配置的 schema（standard-schema 形状，手写）。
 *
 * cordis 的 `resolveConfig` 只消费 `Config['~standard'].validate(config)`：返回 `{ value }` 就用它
 * 替换原始 config，返回 `{ issues }` 就在装载期抛 `ValidationError`，`apply` 根本不会被调用。
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
