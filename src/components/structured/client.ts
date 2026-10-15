/**
 * 结构化提示词组件（client 半边）的槽位注册。
 *
 * 两个入口各注册一次：输入框工具栏里的按钮（`conversation.input.left`）与弹窗挂载点
 * （`conversation.input.dock`）。两处**共用本组件自己的 store 句柄** —— 渲染器按
 * 「handle × sessionId」共享实例，所以入口的 `open()` 会直接驱动弹窗重渲染。
 *
 * 两个注册**都必须声明 `store` 座位**：`useStore`/`actions` 不是标准 props，漏声明会让组件拿到
 * `undefined`、条目被隔离失效（表现是"按钮消失"）。
 */
import type { SendPrompt } from '../../shared/send.js'
import type { SlotEntry } from '../../shared/slots.js'
import { createStructuredInputStore } from './client/store.js'
import { StructuredInputPanel } from './client/ui/Panel.js'
import { StructuredInputTrigger } from './client/ui/Trigger.js'

/**
 * 本组件的槽位注册清单。
 * @param sendPrompt - 把成稿发送进指定会话的宿主回调（两个组件共用同一条链路）。
 * @returns 注册列表。
 */
export function structuredSlotEntries(sendPrompt: SendPrompt): SlotEntry[] {
  const store = createStructuredInputStore()
  return [
    {
      name: 'conversation.input.left',
      options: { name: 'conversation.input.left', id: 'structured-prompt', order: 20, store },
      component: StructuredInputTrigger as SlotEntry['component'],
    },
    {
      name: 'conversation.input.dock',
      options: {
        name: 'conversation.input.dock',
        id: 'structured-prompt',
        order: 10,
        store,
        // 位置参数由声明推导：会话作用域的注册收到的是 (sessionId)。
        inject: (sessionId: string) => ({
          /**
           * 把成稿发送进当前会话。
           * @param prompt - 构建好的提示词。
           */
          onSend: (prompt: string) => { sendPrompt(sessionId, prompt) },
        }),
      },
      component: StructuredInputPanel as SlotEntry['component'],
    },
  ]
}
