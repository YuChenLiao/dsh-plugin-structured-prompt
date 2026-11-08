/**
 * 输入框底部工具栏里的入口按钮（`conversation.input.left`）。
 *
 * 只负责"打开表单"这件事，具体开在哪由宿主能力决定：
 *  - 有右侧栏 tab 通路时，注入的 `open` 直接开 tab（返回 `false` 时退回弹窗）；
 *  - 没有时走 store 的 `open()`，由同源句柄驱动弹窗渲染。
 *
 * 两种外壳共用**同一个 store 句柄**，所以表单内容在两边是同一份，切换外壳不会丢已填内容。
 * （提示词库有它自己的入口按钮与自己的 store，见 `components/library/client/ui/Trigger.tsx`。）
 */
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { StructuredState } from '../../shared/types.js'
import type { FormActions } from '../actions.js'
import s from '../../../../shared/ui/panel.module.css'
/** 入口按钮的 props。 */
export interface StructuredInputTriggerProps {
  /** store 的读座位。 */
  useStore: SnapshotSelectorHook<StructuredState>
  /** store 的写座位。 */
  actions: FormActions
  /** 会话标识；无会话时按钮禁用。 */
  sessionId?: string
  /**
   * 打开表单（由注册的 `inject` 面提供；缺省时用 store 的弹窗开关）。
   *
   * 返回 `false` 表示壳层没接上（例如宿主的 tab 类型没进注册表），于是退回弹窗。
   * 入参是目标会话：`dsh-better-sidebar` 的后端要靠它定位 tab。
   */
  open?: (sessionId?: string) => boolean
}

/**
 * 入口按钮。
 * @param props - store 座位、会话标识与可选的打开通路。
 * @returns 按钮元素。
 */
export function StructuredInputTrigger({
  useStore, actions, sessionId, open,
}: StructuredInputTriggerProps): ReactNode {
  const active = useStore(state => state.active)
  const disabled = sessionId === undefined
  const popup = open === undefined
  return (
    <button
      type="button"
      data-structured-prompt-trigger=""
      data-dsh-prompt-trigger=""
      className={active ? `${s.trigger} ${s.triggerActive}` : s.trigger}
      title={popup ? '结构化输入任务：打开结构化提示词表单' : '结构化输入任务：在右侧栏打开表单'}
      // 有 tab 通路时这不是弹出层：`aria-haspopup`/`aria-expanded` 留给弹窗那条路。
      {...(popup ? { 'aria-haspopup': 'dialog', 'aria-expanded': active } : {})}
      disabled={disabled}
      // 不让按钮抢走输入框的焦点，输入可以无缝继续。
      onMouseDown={(event) => { event.preventDefault() }}
      onClick={() => {
        // 侧栏接管成功就把弹窗关掉：`active` 只有弹窗那条路会写，不关就是两份外壳同屏。
        if (open !== undefined && open(sessionId)) {
          actions.close()
          return
        }
        actions.open()
      }}
    >
      结构化输入任务
    </button>
  )
}
