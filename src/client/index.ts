/**
 * 插件 client 半边：装配两个组件的槽位注册。
 *
 * 两个组件（结构化提示词 / 提示词库）各自提供自己的注册清单（`components/<组件>/client.ts`），本文件
 * 只做两件事：注入一次共享样式，把两份清单交给槽位面。**每个组件各有自己的 store 句柄**，因此
 * 界面上的开关与状态互不干涉 —— 一个组件的变化不经过另一个。
 *
 * 每个注册**都必须声明 `store` 座位**：`useStore`/`actions` 不是标准 props，而是渲染器在
 * `host.storeOf(entry)` 有值时才注入的。漏声明会让组件拿到 `undefined`、渲染时抛错，条目随即
 * 被隔离失效（表现为"按钮消失"）。
 *
 * `inject` 只有 `slots`：本插件不读 `remote.<namespace>`，也不读插件与 skills 清单（手动工具
 * 策略由用户直接填写工具名，理由见 README）。唯一触到主机的动作是发送链路 —— 会话作用域上的
 * `conversation.send`（`src/shared/send.ts`），两个组件共用它。
 *
 * 两个弹窗都挂在 `input.dock`，而不是接管输入框的两个候选：
 *  - `conversation.composer`（chain）：`select` 是纯函数，只在槽位重渲染时重新执行；store 更新
 *    不会触发槽位重渲染，所以链入口无法在用户点击后自行接管。
 *  - `conversation.composer.bar`（single）：遮蔽是静态的，同一 cell 只有最低优先级者渲染，
 *    无法"仅在打开时"接管。
 */
import { librarySlotEntries } from '../components/library/client.js'
import { structuredSlotEntries } from '../components/structured/client.js'
import type { ClientPluginContext } from '../shared/plugin-context.js'
import { sendPrompt } from '../shared/send.js'
import type { SendPrompt } from '../shared/send.js'
import type { SlotEntry } from '../shared/slots.js'
import { PANEL_CSS } from '../shared/ui/styles.js'

/**
 * 插件依赖：只需要槽位注册。
 *
 * 这里刻意不声明 `remote.*`：命名空间是各自注册的 Cordis 服务（键为 `remote.<namespace>`），
 * 硬声明会在缺少该命名空间的组装里让插件停在 PENDING。
 */
export const inject = ['slots'] as const

/**
 * 两个组件的槽位注册清单（合起来）。
 * @param send - 把文本发送进指定会话的宿主回调。
 * @returns 注册列表：结构化组件的两条 + 提示词库组件的两条。
 */
export function slotEntries(send: SendPrompt): SlotEntry[] {
  return [...structuredSlotEntries(send), ...librarySlotEntries(send)]
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
  installStyles(ctx)
  const send: SendPrompt = (sessionId, prompt) => { sendPrompt(ctx, sessionId, prompt) }
  for (const entry of slotEntries(send)) {
    ctx.slots.inject(entry.name, () => ctx.slots.register(entry.options, entry.component))
  }
}
