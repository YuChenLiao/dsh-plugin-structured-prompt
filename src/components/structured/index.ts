/**
 * 结构化提示词组件（host 半边）的装载入口。
 *
 * 形态参考 dsh-ops 的组件：本文件是**瘦入口**，只声明导出面（`inject` / `Config` / `apply`），
 * 实现在同目录的 `host/` 下。这样 `cordis.patch.yml` 里可以把它与提示词库组件各挂一条装载行，
 * 各自带 config、各自可 `disabled`。
 *
 * 导出面刻意只有命名导出、没有 default：函数插件混用 default 会让 Loader 丢掉命名空间
 * （DSH 源码树里的 `docs/postmortem/0001-acp-default-export-drops-inject.md`）。
 */
import type { HostPluginContext } from './host/tool.js'
import { registerStructuredPromptTool } from './host/tool.js'
import { registerAssistRoute } from './host/assist.js'
import type { AssistContext } from './host/assist.js'
import { narrowConfig } from './host/config.js'

/**
 * host 侧依赖：只需要工具注册面。
 *
 * 声明为硬依赖（而不是 `ctx.get` 可选读取）是有意的 —— 没有 `tools` 服务时本组件无事可做，
 * 静默变成空插件反而更难排查。
 */
export const inject = ['tools'] as const

export { Config } from './host/config.js'

/**
 * 组件主体。
 * @param ctx - host 上下文。
 * @param config - 装载行的 `config`。cordis 已用 `Config` 校验并规范化；这里再收窄一次是为了
 *   `apply` 被直接调用（测试、其它组装）时同样安全 —— 形状不对就抛错，不静默忽略。
 */
export function apply(ctx: HostPluginContext, config?: unknown): void {
  const narrowed = narrowConfig(config)
  registerStructuredPromptTool(ctx, narrowed)
  // 自动填充：把一句话扩写成字段补丁。可选能力 —— 没有模型配置也没有子代理服务时它只是
  // 不可用（路由里会给出 501 / 跳过注册），不影响"构建提示词"。
  registerAssistRoute(ctx as unknown as AssistContext, narrowed)
}
