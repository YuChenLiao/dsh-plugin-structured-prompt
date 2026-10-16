/**
 * 输入框底部工具栏里的入口按钮（`conversation.input.left`）。
 *
 * 只负责切换开关：置真后由同一 store 句柄驱动的表单弹窗渲染。两处共用实例，因此不需要任何跨
 * 注册的状态同步。（提示词库有它自己的入口按钮与自己的 store，见
 * `components/library/client/ui/Trigger.tsx` —— 拆分后两个组件在界面上互不干扰。）
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
}

/**
 * 入口按钮。
 * @param props - store 座位与会话标识。
 * @returns 按钮元素。
 */
export function StructuredInputTrigger({
  useStore, actions, sessionId,
}: StructuredInputTriggerProps): ReactNode {
  const active = useStore(state => state.active)
  const disabled = sessionId === undefined
  return (
    <button
      type="button"
      data-structured-prompt-trigger=""
      data-dsh-prompt-trigger=""
      className={active ? `${s.trigger} ${s.triggerActive}` : s.trigger}
      title="结构化输入任务：打开结构化提示词表单"
      aria-haspopup="dialog"
      aria-expanded={active}
      disabled={disabled}
      // 不让按钮抢走输入框的焦点，输入可以无缝继续。
      onMouseDown={(event) => { event.preventDefault() }}
      onClick={() => actions.open()}
    >
      结构化输入任务
    </button>
  )
}
