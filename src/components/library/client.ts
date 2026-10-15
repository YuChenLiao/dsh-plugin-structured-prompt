/**
 * 提示词库组件（client 半边）的槽位注册。
 *
 * 与结构化组件完全平行：自己的入口按钮（`conversation.input.left`）、自己的弹窗挂载点
 * （`conversation.input.dock`）、**自己的 store 句柄**。两个组件因此在界面上互不干扰 ——
 * 一个的开关、状态与渲染都不经过另一个。
 *
 * 两个注册同样都要声明 `store` 座位（漏声明会让组件拿不到 `useStore`，条目被隔离失效）。
 */
import type { SendPrompt } from '../../shared/send.js'
import type { SlotEntry } from '../../shared/slots.js'
import { createLibraryStore } from './client/store.js'
import { LibraryPanel } from './client/ui/Panel.js'
import { LibraryTrigger } from './client/ui/Trigger.js'

/**
 * 本组件的槽位注册清单。
 * @param sendPrompt - 把选中的提示词发送进指定会话的宿主回调（与成稿共用同一条链路）。
 * @returns 注册列表。
 */
export function librarySlotEntries(sendPrompt: SendPrompt): SlotEntry[] {
  const store = createLibraryStore()
  return [
    {
      name: 'conversation.input.left',
      // order 与结构化组件相邻：两个按钮并排出现在工具栏里。
      options: { name: 'conversation.input.left', id: 'prompt-library', order: 21, store },
      component: LibraryTrigger as SlotEntry['component'],
    },
    {
      name: 'conversation.input.dock',
      options: {
        name: 'conversation.input.dock',
        id: 'prompt-library',
        order: 11,
        store,
        inject: (sessionId: string) => ({
          /**
           * 把选中的原文发送进当前会话。
           * @param prompt - 待发送的原文。
           */
          onSend: (prompt: string) => { sendPrompt(sessionId, prompt) },
        }),
      },
      component: LibraryPanel as SlotEntry['component'],
    },
  ]
}
