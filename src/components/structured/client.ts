/**
 * 结构化提示词组件（client 半边）的槽位注册。
 *
 * 三个入口：
 *  - `conversation.input.left` 的「结构化输入任务」按钮（`order: 20`）；
 *  - `conversation.input.left` 的「任务扩写」按钮（`order: 21`）；
 *  - 表单本体的外壳：宿主有右侧栏 tab 能力时挂 `sidebar.right.pane.tab`，
 *    否则退回 `conversation.input.dock` 的弹窗。
 *
 * 两个按钮共用一个槽位，靠 `id` 与 `order` 区分，且只有第一个与表单外壳**共用本组件的 store
 * 句柄** —— 渲染器按「handle × sessionId」共享实例，所以入口能驱动表单重渲染。
 *
 * **需要 store 的注册必须声明 `store` 座位**：`useStore`/`actions` 不是标准 props，漏声明会让组件
 * 拿到 `undefined`、条目被隔离失效（表现是"按钮消失"）。「任务扩写」不声明 store，因为它既不读
 * 表单状态也不需要外壳 —— 它用的是宿主给每个 session 作用域槽位的标准 props（`useInput` /
 * `inputActions`），草稿的读写全靠那两个。
 *
 * 两种外壳都注册，**tab 主体无条件注册**：`ctx.slots.inject('sidebar.right.pane.tab', ...)`
 * 只在宿主声明了那个槽位时才回调，宿主没有时它就是一个永不触发的等待 —— 与其它槽位同一套
 * 语义，不会报错。但"开不开 tab"由 `SidebarSurface.open()` 的返回值决定：`false` 时入口退回
 * 弹窗，弹窗顶部再说明原因（`degradeNote`）。
 */
import type { SendPrompt } from '../../shared/send.js'
import type { SlotEntry } from '../../shared/slots.js'
import { createStructuredInputStore } from './client/store.js'
import type { StructuredInputStore } from './client/store.js'
import { StructuredInputPanel } from './client/ui/Panel.js'
import { StructuredSidebarForm } from './client/ui/SidebarForm.js'
import { TaskTrigger } from './client/ui/TaskTrigger.js'
import { StructuredInputTrigger } from './client/ui/Trigger.js'
import { SIDEBAR_TAB_ID, SIDEBAR_TAB_SLOT } from './client/sidebar.js'
import type { SidebarSurface } from './client/sidebar.js'

/**
 * 本组件的槽位注册清单。
 * @param sendPrompt - 把成稿发送进指定会话的宿主回调（两个组件共用同一条链路）。
 * @param surface - 侧栏通路（better-sidebar → 原生 → 弹窗，已由 `mountSidebarTab` 选好）；
 *   未提供时入口只用弹窗（不注入 `open`）。
 * @param store - 本组件的 store 句柄；缺省时新建一个（只有文档测试会走到这条）。
 * @returns 注册列表：入口两条 + 表单外壳（弹窗，以及原生右侧栏的 tab 主体）。
 */
export function structuredSlotEntries(
  sendPrompt: SendPrompt,
  surface?: SidebarSurface,
  store?: StructuredInputStore,
): SlotEntry[] {
  const handle = store ?? createStructuredInputStore()
  // 揭示表单的通路：有侧栏就交给它，没有就让调用方退回弹窗（返回值就是那句"没有"）。
  const reveal = surface === undefined ? undefined : (sessionId?: string): boolean => surface.open(sessionId)
  return [
    {
      name: 'conversation.input.left',
      options: {
        name: 'conversation.input.left',
        id: 'structured-prompt',
        order: 20,
        store: handle,
        ...(reveal === undefined ? {} : { inject: () => ({ open: reveal }) }),
      },
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
      // 弹窗外壳：没有 tab 通路时它是唯一入口；有 tab 时它仍然注册 —— tab 开不成（`open()` 返回
      // false，例如 kind 没进注册表）的那一刻，它就是用户看到的东西。
      name: 'conversation.input.dock',
      options: {
        name: 'conversation.input.dock',
        id: 'structured-prompt',
        order: 10,
        store: handle,
        // 位置参数由声明推导：会话作用域的注册收到的是 (sessionId)。
        inject: (sessionId: string) => ({
          /**
           * 把成稿发送进当前会话。
           * @param prompt - 构建好的提示词。
           */
          onSend: (prompt: string) => { sendPrompt(sessionId, prompt) },
          ...(surface === undefined
            ? {}
            : {
              /** 「库 → 表单」优先开 tab；返回 false 时容器退回弹窗。 */
              onReveal: reveal,
              /** 降级原因（每次渲染时求值：打开失败后才会有内容）。 */
              degradeNote: () => surface.note(),
            }),
        }),
      },
      component: StructuredInputPanel as SlotEntry['component'],
    },
    {
      // tab 外壳：键必须是第一步注册的类型 id（宿主按 `definition.id` 派发主体）。
      // 宿主没有这个槽位时下面的 `slots.inject` 永不回调 —— 与其它槽位同一套语义。
      name: SIDEBAR_TAB_SLOT,
      options: {
        name: SIDEBAR_TAB_SLOT,
        key: SIDEBAR_TAB_ID,
        store: handle,
        // `sessionId` 显式随 inject 面一起给出：键控槽位的标准 props 里是否带它属于宿主实现细节
        // （生态里的 `dsh-better-sidebar` 也是这么加的），拿不到就等于整个 tab 渲染成空白。
        inject: (sessionId: string) => ({ sessionId, send: sendPrompt }),
      },
      component: StructuredSidebarForm as SlotEntry['component'],
    },
  ]
}
