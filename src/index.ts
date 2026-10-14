/**
 * 插件 host 半边：把结构化提示词能力注册为模型可调用的工具。
 *
 * 客户端半边（`src/client/`）负责输入框里的表单界面，两边共用 `src/shared/` 的构建
 * 逻辑，因此同一个表单或同一组工具参数产出的提示词完全一致。
 *
 * 本半边只注册工具、不读任何会话数据：工具是纯函数（参数进、提示词出），因此不需要
 * `agent` / `session` 之类的依赖。
 *
 * 唯一的配置项是 `provider`（默认走哪个子代理 provider）—— 它属于"部署级选择"：DSH 的
 * base bundle 同时注册 `spawn` 与 `fork`，装第三方 provider 的 profile 还会有别的候选。
 * 不在 `cordis.patch.yml` 里写 `config` 就是现在的行为（内建默认 `spawn`）。
 *
 * 导出面刻意只有 `inject` / `Config` / `apply` 三个**命名**导出，没有 default：函数插件
 * 混用 default 会让 Loader 丢掉命名空间（DSH 源码树里的
 * `docs/postmortem/0001-acp-default-export-drops-inject.md`）。
 */
import type { HostPluginContext } from './host/tool.js'
import { registerStructuredPromptTool } from './host/tool.js'
import { narrowConfig } from './host/config.js'

/**
 * host 侧依赖：只需要工具注册面。
 *
 * 声明为硬依赖（而不是 `ctx.get` 可选读取）是有意的 —— 没有 `tools` 服务时本半边
 * 无事可做，静默变成空插件反而更难排查。
 */
export const inject = ['tools'] as const

export { Config } from './host/config.js'

/**
 * 插件 host 主体。
 * @param ctx - host 上下文。
 * @param config - 装载行的 `config`。cordis 已经用 `Config` 校验并规范化过；这里再收窄一次
 *   是为了 `apply` 被直接调用（测试、其它组装）时同样安全 —— 形状不对就抛错，不静默忽略。
 */
export function apply(ctx: HostPluginContext, config?: unknown): void {
  registerStructuredPromptTool(ctx, narrowConfig(config))
}
