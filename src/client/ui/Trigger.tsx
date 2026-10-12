/**
 * 输入框底部工具栏里的入口按钮（`conversation.input.left`）。
 *
 * 只负责切换开关：置真后由同一 store 句柄驱动的表单弹窗渲染。两处共用实例，
 * 因此不需要任何跨注册的状态同步。
 */
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { StructuredState } from '../../shared/types.js'
import type { FormActions } from './actions.js'
import { COLORS, triggerButtonStyle } from './styles.js'

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
      style={{
        ...triggerButtonStyle,
        borderColor: active ? COLORS.accent : COLORS.border,
        background: active ? COLORS.accentSoft : 'transparent',
        color: active ? COLORS.text : COLORS.textSecondary,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
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
