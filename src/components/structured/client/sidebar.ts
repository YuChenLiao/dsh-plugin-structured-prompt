/**
 * 表单外壳的接入链：**dsh-better-sidebar → 宿主原生右侧栏 → 弹窗**。
 *
 * 为什么要有这一层：弹窗定位在真机上一直修不干净（基准不是视口、包含块被 `transform` 改掉、
 * 祖先链上还有宽度为 0 的槽位父元素），所以表单本体改挂宿主的侧栏 —— 位置与尺寸交给宿主，
 * 插件不再测量任何东西。
 *
 * 三个后端，按顺序取第一个能用的：
 *  1. `dsh-better-sidebar`（`ctx.betterSidebar`）：这台机器上真正在用的侧栏，文件树/编辑器/变更
 *     都在那一列，表单与它们并列；
 *  2. 宿主原生右侧栏（`ctx.sidebarRightTabs` + `sidebar.right.pane.tab`）；
 *  3. 都没有 → 弹窗，并在弹窗顶部说明原因（降级不静默）。
 *
 * **接入必须顺序无关**。第一版在 `apply()` 里用 `ctx.get` 探测一次就定生死，真机结果"出来的还是
 * 弹窗"：服务提供方可能后于本插件 apply，探不到就静默降级了。现在每条后端都有三条路：apply 期
 * 探测 → `ctx.inject([...], …)` 等它出现 → 真正打开时再探一次。better-sidebar 的等待**始终挂着**：
 * 它后到时要能顶掉已经接上的原生后端（并撤掉原生类型，否则同一份表单会在两套 tab 里各出现一次）。
 *
 * `open()` **返回布尔**而不是抛错：入口按钮拿到 `false` 就自己退回弹窗 —— "服务在、但 tab 类型
 * 没进注册表"这类运行期故障因此不会变成按了没反应。
 */
import type { ClientPluginContext } from '../../../shared/plugin-context.js'
import type { SendPrompt } from '../../../shared/send.js'
import type { StructuredInputStore } from './store.js'
import { sidebarNote } from './sidebar-note.js'
import type { SidebarFailure } from './sidebar-note.js'
import { openBetter, probeBetter, registerBetter } from './sidebar-better.js'
import type { BetterSidebarService } from './sidebar-better.js'
import { SIDEBAR_KIND, openNative, probeNative, registerNativeType } from './sidebar-native.js'
import type { NativeServices } from './sidebar-native.js'

export { SIDEBAR_KIND, SIDEBAR_TAB_ID } from './sidebar-native.js'

/** tab 主体的槽位键（宿主 `ui-sidebar-right` 声明的键控槽位）。 */
export const SIDEBAR_TAB_SLOT = 'sidebar.right.pane.tab'

/** 当前用的是哪个后端。 */
export type SidebarBackend = 'better-sidebar' | 'native' | 'none'

/** 接通后的通行面。 */
export interface SidebarSurface {
  /**
   * 打开（或聚焦）表单。
   * @param sessionId - 目标会话（better-sidebar 需要它定位 tab；原生后端忽略）。
   * @returns `true` 表示已交给某个侧栏；`false` 表示没有通路，调用方应退回弹窗。
   */
  open(sessionId?: string): boolean
  /**
   * 降级原因：接通时返回 `undefined`，否则返回一句可直接显示给人看的话。
   * @returns 说明文本，或 `undefined`。
   */
  note(): string | undefined
  /**
   * 当前后端（诊断与测试用）。
   * @returns 后端标识。
   */
  backend(): SidebarBackend
}

/** 挂载所需的依赖。 */
export interface SidebarMountOptions {
  /** 结构化表单的 store 句柄（better-sidebar 的 tab 主体要自己取实例）。 */
  readonly store: StructuredInputStore
  /** 发送链路。 */
  readonly send: SendPrompt
}

/**
 * 接入侧栏，返回通行面。
 *
 * 永不抛错：任何一步失败都收敛成 `open()` 返回 `false` + `note()` 给出原因。
 * @param ctx - 插件上下文。
 * @param options - store 与发送链路。
 * @returns 通行面。三个后端都不可用时 `open()` 恒为 `false`。
 */
export function mountSidebarTab(ctx: ClientPluginContext, options: SidebarMountOptions): SidebarSurface {
  let backend: SidebarBackend = 'none'
  let failure: SidebarFailure | undefined = 'probe'
  let detail = ''
  let better: BetterSidebarService | undefined
  let betterRelease: (() => void) | undefined
  let native: NativeServices | undefined
  let nativeDispose: (() => void) | undefined

  /**
   * 切到 better-sidebar。
   *
   * 幂等判据是**服务实例身份**，不是 `backend` 字符串：插件重载 / 禁用后重新启用会让
   * `ctx.inject` 的回调再跑一次、拿到**新**的服务实例，而宿主对同一 id 的第二次 `registerTab`
   * 会抛错 —— 所以换实例时必须先释放旧的再注册新的，否则接入会永久停在旧实例上（表现是
   * 点击既不打开也不降级）。
   * @param service - 已探测到的服务。
   * @returns 是否接通。
   */
  const wireBetter = (service: BetterSidebarService): boolean => {
    if (backend === 'better-sidebar' && better === service) return true
    if (backend === 'better-sidebar') {
      // 换了实例：撤掉旧的，回到未接入状态再重注册。
      try {
        betterRelease?.()
      } catch (error) {
        console.warn('[structured-prompt] 释放旧的 better-sidebar tab 类型失败：', error)
      }
      betterRelease = undefined
      better = undefined
      backend = 'none'
    }
    try {
      const release = registerBetter(service, { store: options.store, send: options.send })
      betterRelease = release
      try {
        ctx.effect(() => release, 'structured-prompt: better-sidebar tab 类型')
      } catch {
        console.warn('[structured-prompt] better-sidebar tab 类型未挂上 fiber 释放')
      }
    } catch (error) {
      failure = 'register'
      detail = error instanceof Error ? error.message : String(error)
      console.error('[structured-prompt] better-sidebar 注册 tab 失败，改用下一个后端：', error)
      return false
    }
    better = service
    backend = 'better-sidebar'
    failure = undefined
    // 撤掉已挂上的原生类型：否则同一份表单会在两个 tab 体系里各出现一次。
    // 先关掉"正开着的那一个"：类型一撤，宿主按 id 派发不到主体，那个 tab 会变成写着
    // 「内容不可用」的空壳（`SidebarRight.tsx` 的 `tab.unavailable` 兜底）。
    if (nativeDispose !== undefined) {
      try {
        const activeTab = native?.right.active?.()
        if (activeTab !== undefined && activeTab.kind === SIDEBAR_KIND) native?.right.close?.(activeTab.id)
      } catch (error) {
        console.warn('[structured-prompt] 关闭已打开的原生 tab 失败：', error)
      }
      try {
        nativeDispose()
      } catch (error) {
        console.warn('[structured-prompt] 反注册原生 tab 类型失败：', error)
      }
      nativeDispose = undefined
    }
    native = undefined
    return true
  }

  /**
   * 切到宿主原生右侧栏。
   *
   * better-sidebar 一旦在用就不再接原生；同一后端换了服务实例时同样先释放旧的再注册
   * （宿主对重复 id 会抛错）。
   * @param found - 已探测到的两个服务。
   * @returns 是否接通。
   */
  const wireNative = (found: NativeServices): boolean => {
    if (backend === 'better-sidebar') return true
    if (backend === 'native' && native === found) return true
    if (backend === 'native') {
      try {
        nativeDispose?.()
      } catch (error) {
        console.warn('[structured-prompt] 释放旧的原生 tab 类型失败：', error)
      }
      nativeDispose = undefined
      native = undefined
      backend = 'none'
    }
    try {
      nativeDispose = registerNativeType(ctx, found.tabs)
    } catch (error) {
      failure = 'register'
      detail = error instanceof Error ? error.message : String(error)
      console.error('[structured-prompt] 原生右侧栏 tab 注册失败，退回弹窗：', error)
      return false
    }
    native = found
    backend = 'native'
    failure = undefined
    return true
  }

  /**
   * 按优先级解析一次后端。
   *
   * **不能**在"已接上原生"时提前返回：better-sidebar 可能晚于本插件出现（老宿主上甚至没有
   * `ctx.inject` 的等待），那时唯一能升级的机会就是打开时的这一次解析。
   * @returns 解析后的后端。
   */
  const resolve = (): SidebarBackend => {
    if (backend === 'better-sidebar' && better !== undefined) return backend
    const betterService = probeBetter(ctx)
    if (betterService !== undefined && wireBetter(betterService)) return backend
    if (backend === 'native' && native !== undefined) return backend
    const found = probeNative(ctx)
    if (found !== undefined) wireNative(found)
    return backend
  }

  // 1) apply 期立即探测。
  const resolved = resolve()
  // 2) 服务迟到：better-sidebar 那条**总是**挂着 —— 它后到时要能顶掉已经接上的原生后端。
  try {
    ctx.inject?.(['betterSidebar'], (scope) => {
      const service = probeBetter(scope) ?? probeBetter(ctx)
      if (service !== undefined) wireBetter(service)
    })
  } catch (error) {
    // 老实现没有 `ctx.inject`：只剩第 3 步的"打开时再探"。
    console.warn('[structured-prompt] 无法等待 better-sidebar，改在打开时探测：', error)
  }
  // 原生那条只在还没有后端时才有意义（有了 better-sidebar 就不必再接原生）。
  if (resolved === 'none') {
    try {
      ctx.inject?.(['sidebarRightTabs', 'sidebarRight'], (scope) => {
        if (probeNative(scope) !== undefined) resolve()
      })
    } catch (error) {
      console.warn('[structured-prompt] 无法等待原生右侧栏，改在打开时探测：', error)
    }
  }

  return {
    backend: () => backend,
    open(sessionId) {
      // 3) 运行期最后一次机会：此时服务一定已提供。
      let which: SidebarBackend
      try {
        which = resolve()
      } catch (error) {
        // 接线（含反注册 disposer、切换后端）的任何异常都不许抛给点击处理器。
        failure = 'probe'
        detail = error instanceof Error ? error.message : String(error)
        console.error('[structured-prompt] 解析侧栏后端失败，退回弹窗：', error)
        return false
      }
      try {
        if (which === 'better-sidebar' && better !== undefined) openBetter(better, sessionId)
        else if (which === 'native' && native !== undefined) openNative(native)
        else return false
      } catch (error) {
        failure = 'open'
        detail = error instanceof Error ? error.message : String(error)
        console.error('[structured-prompt] 打开侧栏 tab 失败，退回弹窗：', error)
        return false
      }
      failure = undefined
      return true
    },
    note: () => sidebarNote(failure, detail, ctx),
  }
}
