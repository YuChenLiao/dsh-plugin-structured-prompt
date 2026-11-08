/**
 * 宿主原生右侧栏后端：注册 tab 类型（`sidebarRightTabs`）并按 kind 打开（`sidebarRight`）。
 *
 * 契约住在宿主 `ui-sidebar-right` 包里：类型注册是可选的"第一阶段"，主体注册在键控槽位
 * `sidebar.right.pane.tab` 里（见 `client.ts`），两者用**同一个常量**当身份 —— 宿主按
 * `definition.id` 派发主体，键写错的表现是"tab 打开了但空白"。
 */
import type { ClientPluginContext } from '../../../shared/plugin-context.js'
import { serviceOf } from './probe.js'

/** 原生右侧栏的 tab 类型：打开时用它的 kind，也是 `openTab` 的入参。 */
export const SIDEBAR_KIND = 'structured-prompt-form'

/** 本实现在原生右侧栏里的唯一标识，同时是 tab 主体的注册键。 */
export const SIDEBAR_TAB_ID = 'dsh-plugin-structured-prompt/structured-prompt-form'

/** 宿主原生右侧栏的类型注册表（`ctx.sidebarRightTabs`）里本插件用到的部分。 */
export interface TabsService {
  /**
   * 注册一个 tab 类型。
   * @param definition - 类型定义（id / kind / priority / title）。
   * @returns 反注册函数。
   */
  register(definition: Record<string, unknown>): unknown
}

/** 宿主原生右侧栏面（`ctx.sidebarRight`）里本插件用到的部分。 */
export interface RightService {
  /**
   * 按 kind 打开（或聚焦）一个页面 tab。
   * @param kind - 页面类型的 kind。
   */
  openTab(kind: string): void
  /**
   * 活动标签页（只在宿主提供时才能问）。
   *
   * 切换后端时要先把**正开着的那个**关掉：类型一撤，宿主派发不到主体，那个 tab 会变成
   * 写着「内容不可用」的空壳。
   * @returns 记录，或无座位挂载时的 `undefined`。
   */
  active?(): { readonly id: string; readonly kind?: string | undefined } | undefined
  /**
   * 关闭一个标签页（只在宿主提供时才能用）。
   * @param tabId - 标签页 id。
   */
  close?(tabId: string): void
}

/** 探测原生右侧栏的两个服务。 */
export type NativeServices = { tabs: TabsService; right: RightService }

/**
 * 探测宿主原生右侧栏。
 * @param ctx - 插件上下文。
 * @returns 两个服务都在时返回它们。
 */
export function probeNative(ctx: ClientPluginContext): NativeServices | undefined {
  const tabs = serviceOf<TabsService>(ctx, 'sidebarRightTabs', 'register')
  if (tabs === undefined) return undefined
  const right = serviceOf<RightService>(ctx, 'sidebarRight', 'openTab')
  if (right === undefined) return undefined
  return { tabs, right }
}

/**
 * 注册原生 tab 类型，返回反注册函数。
 *
 * 优先经 `ctx.effect` 挂上 fiber（随插件卸载释放）；不在 apply 阶段调用时 `effect` 可能不可用，
 * 那就直接注册并留一条日志 —— 漏掉的反注册只影响热卸载，不影响使用。
 * @param ctx - 插件上下文。
 * @param tabs - 类型注册表。
 * @returns 反注册函数（重复调用无害）。
 * @throws 服务拒绝注册时抛出，由调用方决定是否退回其它后端。
 */
export function registerNativeType(ctx: ClientPluginContext, tabs: TabsService): () => void {
  const raw = tabs.register({
    id: SIDEBAR_TAB_ID,
    kind: SIDEBAR_KIND,
    // 外部插件默认就是这一档；写出来是为了让读者不必回查宿主源码。
    priority: 'extension',
    // 页面类型：按 kind 打开，不认领资源地址（没有 `patterns`）。
    title: () => '结构化提示词',
    // 引导页入口：没有它，这个类型只能靠输入框的按钮发现 —— 用户一旦关掉 tab 就再也找不回来。
    // 文案与 better-sidebar 那条描述符保持一致（两条后端的发现性要对等）。
    guide: [{
      order: 60,
      title: () => '结构化提示词',
      description: () => '把一句话任务拼成结构化提示词',
    }],
  })
  let released = false
  /**
   * 反注册（幂等）：既给了 `ctx.effect`，也可能被"换成 better-sidebar"时提前调用。
   * @returns 无。
   */
  const release = (): void => {
    if (released) return
    released = true
    if (typeof raw === 'function') (raw as () => void)()
  }
  try {
    ctx.effect(() => release, 'structured-prompt: 右侧栏 tab 类型')
  } catch {
    console.warn('[structured-prompt] tab 类型未挂上 fiber 释放（热卸载时需手动清理）')
  }
  return release
}

/**
 * 按 kind 打开（或聚焦）原生 tab。
 * @param services - 已探测到的服务。
 * @throws 宿主拒绝打开时抛出（kind 没进注册表 / 当前会话没有挂载的右栏）。
 */
export function openNative(services: NativeServices): void {
  services.right.openTab(SIDEBAR_KIND)
}
