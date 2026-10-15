/**
 * 插件 host 半边：把结构化提示词能力注册为模型可调用的工具，并代发提示词库的检索请求。
 *
 * 客户端半边（`src/client/`）负责输入框里的表单界面与提示词库弹窗；表单与工具共用
 * `src/shared/` 的构建逻辑，因此同一个表单或同一组工具参数产出的提示词完全一致。
 * 提示词库那条路径**不经过构建器**：检索到的是别人写好的成品文本，只被预览与发送。
 *
 * 工具是纯函数（参数进、提示词出），不读任何会话数据；检索路由是本半边唯一触网的部分，
 * 它必须由宿主代发的原因见 `host/library.ts`（上游没有 CORS 头，浏览器直连会被拒）。
 *
 * 两个配置项都是"部署级选择"：`provider`（默认走哪个子代理 provider）与 `libraryBaseUrl`
 * （提示词库地址，指向自托管实例时用）。不在 `cordis.patch.yml` 里写 `config` 就是现在的行为。
 *
 * 导出面刻意只有 `inject` / `Config` / `apply` 三个**命名**导出，没有 default：函数插件
 * 混用 default 会让 Loader 丢掉命名空间（DSH 源码树里的
 * `docs/postmortem/0001-acp-default-export-drops-inject.md`）。
 */
import type { HostPluginContext } from './host/tool.js'
import { registerStructuredPromptTool } from './host/tool.js'
import { narrowConfig } from './host/config.js'
import { registerLibraryRoute } from './host/library.js'

/**
 * host 侧依赖：只需要工具注册面。
 *
 * 声明为硬依赖（而不是 `ctx.get` 可选读取）是有意的 —— 没有 `tools` 服务时本半边
 * 无事可做，静默变成空插件反而更难排查。提示词库的两条路由不走这里：它们在
 * `ctx.inject(['connection'], …)` 的就绪回调里注册（`host/library.ts`），没有 web 载体的组装里
 * 自然不注册，其余能力不变。
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
  const narrowed = narrowConfig(config)
  registerStructuredPromptTool(ctx, narrowed)
  registerLibraryRoute(ctx, narrowed)
}
