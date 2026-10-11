/**
 * 结构化输入任务插件 —— DSH 浏览器半边。
 *
 * 两个槽位注册，共用同一个 `store` 句柄：
 *  - `conversation.input.left`（list）—— 输入框底部工具栏里的入口按钮。
 *  - `conversation.input.dock`（list）—— 打开时渲染表单弹窗，关闭时不占空间。
 *
 * 两个注册**都必须声明 `store` 座位**：`useStore`/`actions` 不是标准 props，而是
 * 渲染器在 `host.storeOf(entry)` 有值时才注入的。漏声明会让组件拿到 `undefined`、
 * 渲染时抛错，条目随即被隔离失效（表现为"按钮消失"）。
 *
 * 本插件不读取任何主机数据：手动工具策略由用户直接填写工具名，不再从"已安装
 * 清单"里勾选 —— DSH 的插件清单列的是自带插件而非用户安装的插件，skills 清单
 * 也不属于本插件的职责；工具检索在输入框的 `/` 菜单里。因此 `inject` 只有
 * `slots`，也没有任何 RPC。
 *
 * 表单弹窗挂在 `input.dock`，而不是接管输入框的两个候选：
 *  - `conversation.composer`（chain）：`select` 是纯函数，只在槽位重渲染时重新
 *    执行；store 更新不会触发槽位重渲染（只有 session 源/props 变化才会），所以
 *    链入口无法在用户点击后自行接管。
 *  - `conversation.composer.bar`（single）：遮蔽是静态的，同一 cell 只有最低
 *    优先级者渲染，无法"仅在打开时"接管。
 */
import { createStructuredInputStore } from './store.js'
import type { StructuredInputStore } from './store.js'
import { StructuredInputPanel } from './ui/Panel.js'
import { StructuredInputTrigger } from './ui/Trigger.js'
import { PANEL_CSS } from './ui/styles.js'

/**
 * 插件依赖：只需要槽位注册。
 *
 * 这里刻意不声明 `remote.*`：命名空间是各自注册的 Cordis 服务（键为
 * `remote.<namespace>`），硬声明会在缺少该命名空间的组装里让插件停在 PENDING。
 * 本插件目前不读主机数据，因此没有这类依赖。
 */
export const inject = ['slots'] as const

/** 槽位注册描述。 */
export interface SlotEntry {
  /** 目标槽位键。 */
  name: string
  /** 注册选项（含 `store` 座位）。 */
  options: Record<string, unknown>
  /** 组件。 */
  component: (props: never) => unknown
}

/**
 * 本插件的槽位注册表。
 *
 * 两个注册共享同一个 store 句柄，渲染器按「handle × sessionId」共享实例，因此
 * 入口的 `open()` 会直接驱动弹窗组件重渲染。
 * @param store - `createStructuredInputStore()` 的句柄。
 * @returns 注册三元组列表。
 */
export function slotEntries(store: StructuredInputStore): SlotEntry[] {
  return [
    {
      name: 'conversation.input.left',
      options: { name: 'conversation.input.left', id: 'structured-prompt', order: 20, store },
      component: StructuredInputTrigger as SlotEntry['component'],
    },
    {
      name: 'conversation.input.dock',
      options: { name: 'conversation.input.dock', id: 'structured-prompt', order: 10, store },
      component: StructuredInputPanel as SlotEntry['component'],
    },
  ]
}

/** 本插件用到的 Cordis 上下文（只声明实际消费的部分）。 */
export interface ClientPluginContext {
  /**
   * 注册一个随插件 fiber 释放的副作用。
   * @param factory - 立即执行并返回清理函数的工厂。
   * @param label - 诊断标签。
   */
  effect(factory: () => void | (() => void), label: string): unknown
  slots: {
    /**
     * 等目标槽位被声明后注册。
     * @param key - 槽位键。
     * @param callback - 注册回调。
     */
    inject(key: string, callback: () => void): unknown
    /**
     * 注册一个槽位条目。
     * @param options - 注册选项。
     * @param component - 组件。
     */
    register(options: Record<string, unknown>, component: unknown): unknown
  }
}

/** 注入的样式标签选择器，避免重复加载时叠加。 */
const STYLE_SELECTOR = 'style[data-plugin-css="dsh-plugin-structured-prompt"]'

/**
 * 注入一次插件样式（内联样式覆盖不到的伪类与滚动条）。
 * @param ctx - 插件上下文。
 */
function installStyles(ctx: ClientPluginContext): void {
  ctx.effect(() => {
    if (document.querySelector(STYLE_SELECTOR) === null) {
      const tag = document.createElement('style')
      tag.dataset['plugin'] = 'dsh-plugin-structured-prompt'
      tag.dataset['pluginCss'] = 'dsh-plugin-structured-prompt'
      tag.textContent = PANEL_CSS
      document.head.appendChild(tag)
    }
    return () => {
      document.querySelector(STYLE_SELECTOR)?.remove()
    }
  }, 'structured-prompt: styles')
}

/**
 * 客户端插件主体。
 * @param ctx - Web Client 根上下文。
 */
export function apply(ctx: ClientPluginContext): void {
  const store = createStructuredInputStore()
  installStyles(ctx)
  for (const entry of slotEntries(store)) {
    ctx.slots.inject(entry.name, () => ctx.slots.register(entry.options, entry.component))
  }
}
