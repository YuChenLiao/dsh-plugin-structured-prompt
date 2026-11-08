/**
 * 降级说明的文案：把"接入到哪一步失败了"翻译成一句能直接显示给人看的话。
 *
 * 单独一个文件有两个原因：`sidebar.ts` 已经顶到行数上限；而这段文字是**给用户看的**，
 * 与"接线怎么发生"是两件事，混在一起时改文案容易碰坏时序逻辑。
 *
 * 探测失败那句必须带上证据（三个服务各自的可见性）：只写"宿主没有能力"分不清"宿主真的没有"
 * 与"服务在本插件的作用域里看不到"—— 这两种要修的地方完全不同。
 */
import type { ClientPluginContext } from '../../../shared/plugin-context.js'
import { describeServices } from './probe.js'

/** 接入到哪一步失败了。 */
export type SidebarFailure = 'probe' | 'register' | 'open'

/**
 * 生成降级说明。
 * @param failure - 失败阶段；接通时为 `undefined`。
 * @param detail - 原始错误信息（注册/打开阶段）。
 * @param ctx - 插件上下文（探测阶段用它列出各服务可见性）。
 * @returns 说明文本，接通时返回 `undefined`。
 */
export function sidebarNote(
  failure: SidebarFailure | undefined,
  detail: string,
  ctx: ClientPluginContext,
): string | undefined {
  if (failure === undefined) return undefined
  if (failure === 'open') return `打开侧栏 tab 失败（${detail}），已退回弹窗。`
  if (failure === 'register') return `侧栏 tab 注册失败（${detail}），表单以弹窗打开。`
  const seen = describeServices(ctx, [
    ['betterSidebar', 'registerTab', 'openTab'],
    ['sidebarRightTabs', 'register'],
    ['sidebarRight', 'openTab'],
  ])
  return `宿主未提供侧栏 tab 能力（${seen}），表单以弹窗打开。`
}
