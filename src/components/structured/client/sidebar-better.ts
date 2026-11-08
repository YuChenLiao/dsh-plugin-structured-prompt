/**
 * dsh-better-sidebar 后端：把表单注册成它的一个 tab 类型。
 *
 * 为什么优先它：`dsh-better-sidebar` 是这台机器上真正在用的侧栏（文件树 / 编辑器 / 变更 / 任务
 * 都在那一列），表单进去之后与它们并列；它自己会把类型落到 DSH 原生的右侧栏里，所以"优先
 * better-sidebar"并不牺牲位置，只是让 tab 归到用户习惯的那一套 tab 体系。
 *
 * 契约（读它 0.28.0 的 `lib/types/client/service.d.ts`）：
 *  - `ctx.betterSidebar.registerTab(descriptor)` → 反注册函数；
 *  - `descriptor.component` 收到 `{ scope: { sessionId, cwd? }, tab, visible, … }`；
 *  - `openTab(seed, scope?)`，`seed.type` 就是描述符的 `id`；`single: true` 让重复打开聚焦而不是
 *    再开一个。
 *
 * 关键差异：它的 tab 主体**不是插槽组件**，拿不到 `useStore` 座位，只能自己 `store.create()`
 * —— 所以 `createStructuredInputStore` 按 `scopeKey` 缓存实例，两侧才是同一份状态。
 */
import { createElement } from 'react'
import type { ClientPluginContext } from '../../../shared/plugin-context.js'
import type { SendPrompt } from '../../../shared/send.js'
import type { StructuredInputStore } from './store.js'
import { StructuredBetterTab } from './ui/BetterTab.js'
import { serviceOf } from './probe.js'

/** 本插件在 better-sidebar 里的 tab 类型 id（也是 `openTab({ type })` 的取值）。 */
export const BETTER_TAB_ID = 'dsh-plugin-structured-prompt:form'

/** `getSnapshot()` 里本插件用到的部分。 */
interface BetterSnapshot {
  /** 当前激活的会话；某个会话成为激活会话之前是 `undefined`。 */
  readonly sessionId?: string | undefined
}

/** `ctx.betterSidebar` 里本插件用到的部分。 */
export interface BetterSidebarService {
  /**
   * 注册一个 tab 类型。
   * @param descriptor - 类型描述符（id / title / component / …）。
   * @returns 反注册函数（随插件 fiber 释放）。
   */
  registerTab(descriptor: Record<string, unknown>): unknown
  /**
   * 打开（或聚焦）一个 tab。
   * @param seed - 打开请求，`type` 是描述符 id。
   * @param scope - 会话作用域；省略时宿主按已激活的会话处理。
   */
  openTab(seed: { type: string }, scope?: { sessionId: string }): void
  /**
   * 该类型是否在侧栏设置里启用（只在宿主提供时才能问）。
   *
   * 这是**必须问**的：`openTab` 对"被禁用"的类型是**静默 no-op**（契约原文 "A disabled tab
   * type is a no-op"），不抛错 —— 不问就会把"按了没反应"当成"已打开"。
   */
  isTabEnabled?(id: string): boolean
  /**
   * 按 id 找已注册的描述符（只在宿主提供时才能问）。
   *
   * `openTab` 找不到描述符时同样静默返回，所以也要问一句。
   */
  getTab?(id: string): unknown
  /**
   * 当前侧栏快照（只为 `sessionId` 而问）：调用方没带会话时用它兜底。
   * @returns 含激活会话 id 的快照。
   */
  getSnapshot?(): BetterSnapshot
}

/** 注册与打开都要用到的上下文。 */
export interface BetterOptions {
  /** 结构化表单的 store 句柄（与插槽侧共用同一份实例缓存）。 */
  readonly store: StructuredInputStore
  /** 发送链路。 */
  readonly send: SendPrompt
}

/**
 * 探测 `ctx.betterSidebar`。
 * @param ctx - 插件上下文。
 * @returns 服务，或未安装时 `undefined`。
 */
export function probeBetter(ctx: ClientPluginContext): BetterSidebarService | undefined {
  return serviceOf<BetterSidebarService>(ctx, 'betterSidebar', 'registerTab', 'openTab')
}

/**
 * 注册 tab 类型。
 * @param service - 已探测到的服务。
 * @param options - store 与发送链路。
 * @returns 反注册函数（重复调用无害）。
 * @throws 服务拒绝注册时抛出，由调用方决定是否退回其它后端。
 */
export function registerBetter(service: BetterSidebarService, options: BetterOptions): () => void {
  const raw = service.registerTab({
    id: BETTER_TAB_ID,
    title: () => '结构化提示词',
    description: () => '把一句话任务拼成结构化提示词',
    // 重复打开只聚焦：同一个会话里不需要两份表单。
    single: true,
    order: 60,
    component: (props: { scope?: { sessionId?: string } }) => createElement(StructuredBetterTab, {
      store: options.store,
      send: options.send,
      sessionId: props.scope?.sessionId,
    }),
  })
  let released = false
  return () => {
    if (released) return
    released = true
    if (typeof raw === 'function') (raw as () => void)()
  }
}

/**
 * 打开（或聚焦）本插件的 tab。
 *
 * **先自证再开**：better-sidebar 的 `openTab` 有三条"只 return、不抛错"的拒绝路径 ——
 * 类型被用户在侧栏设置里关掉、描述符不在注册表、没有目标会话。不自证的话 `open()` 会返回
 * `true`（没抛错嘛），入口就不退回弹窗，用户看到的是按了没反应。
 * @param service - 已探测到的服务。
 * @param sessionId - 目标会话；不传时用侧栏当前的激活会话兜底。
 * @throws 任一条拒绝路径成立时抛出（调用方据此收敛成 `false` + 原因）。
 */
export function openBetter(service: BetterSidebarService, sessionId: string | undefined): void {
  if (service.isTabEnabled !== undefined && !service.isTabEnabled(BETTER_TAB_ID)) {
    throw new Error('该 tab 类型在 dsh-better-sidebar 设置里被禁用')
  }
  if (service.getTab !== undefined && service.getTab(BETTER_TAB_ID) === undefined) {
    throw new Error('tab 类型未进入 dsh-better-sidebar 注册表')
  }
  const target = sessionId ?? service.getSnapshot?.().sessionId
  if (target === undefined) throw new Error('没有可用的会话作用域')
  service.openTab({ type: BETTER_TAB_ID }, { sessionId: target })
}
