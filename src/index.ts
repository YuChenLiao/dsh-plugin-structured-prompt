/**
 * 插件 host 半边：把结构化提示词能力注册为模型可调用的工具。
 *
 * 客户端半边（`src/client/`）负责输入框里的表单界面，两边共用 `src/shared/` 的构建
 * 逻辑，因此同一个表单或同一组工具参数产出的提示词完全一致。
 *
 * 本半边只注册工具、不读任何会话数据：工具是纯函数（参数进、提示词出），因此不需要
 * `agent` / `session` 之类的依赖。
 */
import type { HostPluginContext } from './host/tool.js'
import { registerStructuredPromptTool } from './host/tool.js'

/**
 * host 侧依赖：只需要工具注册面。
 *
 * 声明为硬依赖（而不是 `ctx.get` 可选读取）是有意的 —— 没有 `tools` 服务时本半边
 * 无事可做，静默变成空插件反而更难排查。
 */
export const inject = ['tools'] as const

/**
 * 插件 host 主体。
 * @param ctx - host 上下文。
 */
export function apply(ctx: HostPluginContext): void {
  registerStructuredPromptTool(ctx)
}
