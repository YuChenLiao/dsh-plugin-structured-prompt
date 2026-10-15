/**
 * 提示词库组件（host 半边）的装载入口。
 *
 * 与结构化组件分开成两条装载行（形态参考 dsh-ops）：它可以单独 `disabled`，`config` 只认
 * `libraryBaseUrl`。
 *
 * **没有硬依赖**：检索路由读的是 `ctx.get('connection')`（可选），没有 web 载体的组装里什么
 * 都不注册，也不会让插件停在未激活状态 —— 与结构化组件把 `tools` 声明成硬依赖形成对照，
 * 这是两组件的真实差别，不是写法不一致。
 */
import type { LibraryRouteContext } from './host/library.js'
import { registerLibraryRoute } from './host/library.js'
import { narrowConfig } from './host/config.js'

/** host 侧依赖：本组件不需要任何硬依赖。 */
export const inject = [] as const

export { Config } from './host/config.js'

/**
 * 组件主体。
 * @param ctx - host 上下文（只需要可选读取与 `ctx.inject` / `ctx.effect` 面）。
 * @param config - 装载行的 `config`；形状不对就抛错，不静默忽略。
 */
export function apply(ctx: LibraryRouteContext, config?: unknown): void {
  registerLibraryRoute(ctx, narrowConfig(config))
}
