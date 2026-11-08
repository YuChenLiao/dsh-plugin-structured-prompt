/**
 * 结构化提示词组件（client 半边）的槽位注册。
 *
 * 三个入口：
 *  - `conversation.input.left` 的「结构化输入任务」按钮（`order: 20`）；
 *  - `conversation.input.left` 的「任务扩写」按钮（`order: 21`）；
 *  - `conversation.input.dock` 的弹窗挂载点（`order: 10`）。
 *
 * 前两个共用一个槽位，靠 `id` 与 `order` 区分。前两个里只有第一个与挂载点**共用本组件的 store
 * 句柄** —— 渲染器按「handle × sessionId」共享实例，所以入口的 `open()` 会直接驱动弹窗重渲染。
 *
 * **需要 store 的注册必须声明 `store` 座位**：`useStore`/`actions` 不是标准 props，漏声明会让组件
 * 拿到 `undefined`、条目被隔离失效（表现是"按钮消失"）。「任务扩写」不声明 store，因为它既不读
 * 表单状态也不需要面板 —— 它用的是宿主给每个 session 作用域槽位的标准 props
 * （`useInput` / `inputActions`），草稿的读写全靠那两个。
 */
import type { SendPrompt } from '../../shared/send.js'
import type { SlotEntry } from '../../shared/slots.js'
import { createStructuredInputStore } from './client/store.js'
import { StructuredInputPanel } from './client/ui/Panel.js'
import { TaskTrigger } from './client/ui/TaskTrigger.js'
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
      // 「任务扩写」：把输入框里那句话扩写成完整任务并回填，不弹窗。因此不需要 store
      // 座位 —— 它的状态是组件本地的，草稿读写走宿主给的标准 props。
      name: 'conversation.input.left',
      options: { name: 'conversation.input.left', id: 'structured-prompt-task', order: 21 },
      component: TaskTrigger as SlotEntry['component'],
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
