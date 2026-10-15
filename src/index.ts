/**
 * 插件 host 半边：装配两个组件（结构化提示词 / 提示词库）。
 *
 * 两个组件各自是一个**独立的装载单元**（`components/structured/index.ts`、
 * `components/library/index.ts`）：`cordis.patch.yml` 里各挂一条装载行，各有自己的 `config`
 * 与 `disabled`，因此可以单独开关、单独配置。形态参考 dsh-ops 的组件做法。
 *
 * 本文件保留为**聚合入口**：装配两个组件一次装完，供"只写一条装载行"的组装（以及直接调用
 * `apply` 的测试）使用。两条装载行的组装里，Loader 会分别调用组件入口 —— 走的是同一份实现。
 *
 * 因为要装配结构化组件，本入口的硬依赖仍是 `tools`；提示词库组件本身没有硬依赖（它只在
 * `ctx.inject(['connection'], …)` 就绪回调里注册路由）。导出面刻意只有命名导出、没有 default：
 * 函数插件混用 default 会让 Loader 丢掉命名空间（DSH 源码树里的
 * `docs/postmortem/0001-acp-default-export-drops-inject.md`）。
 */
import type { HostPluginContext } from './components/structured/host/tool.js'
import { apply as applyLibrary } from './components/library/index.js'
import { apply as applyStructured } from './components/structured/index.js'
import { narrowConfig as narrowLibraryConfig } from './components/library/host/config.js'
import { narrowConfig as narrowStructuredConfig } from './components/structured/host/config.js'

/** 聚合入口接受的字段：`provider` 归结构化组件，`libraryBaseUrl` 归提示词库组件。 */
const CONFIG_FIELDS = ['provider', 'libraryBaseUrl'] as const

/**
 * 聚合入口的配置 schema。
 *
 * 它只做**分派层**的检查（是不是对象、有没有不认识的字段）：字段本身的形状由两个组件各自的
 * `Config` 校验，那两份才是配置的真源。导出它是为了让"只写一条装载行（包名）"的组装也有装载期
 * 校验 —— 没有 `Config` 时 cordis 会把 config 原样交给 `apply`，校验退化成运行期抛错。
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-plugin-structured-prompt',
    /**
     * 校验装载行配置的分派层形状。
     * @param value - 装载行的 `config`；未写时为 `undefined`。
     * @returns 合法时原样返回（字段级收窄交给组件），否则给出问题列表。
     */
    validate(value: unknown) {
      if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) {
        return { issues: [{ message: 'config must be an object' }] }
      }
      const record = (value ?? {}) as Record<string, unknown>
      const unsupported = Object.keys(record)
        .filter(key => !(CONFIG_FIELDS as readonly string[]).includes(key))
      if (unsupported.length > 0) {
        return { issues: [{ message: `unsupported config field(s): ${unsupported.join(', ')}` }] }
      }
      // 字段形状交给组件那两份 `Config`（配置的真源）：这里各调一次，好让**包名装载行**的报错时机
      // 与组件装载行的完全一致 —— 都是装载期 `ValidationError`，而不是退化成 `apply` 期抛错。
      try {
        narrowStructuredConfig({ provider: record['provider'] })
        narrowLibraryConfig({ libraryBaseUrl: record['libraryBaseUrl'] })
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
      return { value: record }
    },
  },
} as const

/**
 * host 侧依赖：装配结构化组件需要工具注册面。
 *
 * 声明为硬依赖（而不是 `ctx.get` 可选读取）是有意的 —— 没有 `tools` 服务时结构化组件无事可做，
 * 静默变成空插件反而更难排查。
 */
export const inject = ['tools'] as const

/**
 * 装配两个组件。
 * @param ctx - host 上下文。
 * @param config - 聚合写法下的配置：`{ provider?, libraryBaseUrl? }`。字段形状分别交给两个组件
 *   自己的 `Config` 校验（不合规就抛错，不静默忽略）；两条装载行的组装不走这里。
 */
export function apply(ctx: HostPluginContext, config?: unknown): void {
  if (config !== undefined && config !== null && (typeof config !== 'object' || Array.isArray(config))) {
    throw new Error('structured-prompt: invalid config — config must be an object')
  }
  const record = (config ?? {}) as Record<string, unknown>
  const unsupported = Object.keys(record)
    .filter(key => !(CONFIG_FIELDS as readonly string[]).includes(key))
  if (unsupported.length > 0) {
    throw new Error(`structured-prompt: invalid config — unsupported config field(s): ${unsupported.join(', ')}`)
  }
  applyStructured(ctx, { provider: record['provider'] })
  applyLibrary(ctx, { libraryBaseUrl: record['libraryBaseUrl'] })
}
