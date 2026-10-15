/**
 * 提示词库的入口按钮（`conversation.input.left`）。
 *
 * 与结构化组件的入口完全平行：自己的 store、自己的开关、自己的弹窗。order 与结构化入口相邻，
 * 因此两个按钮在工具栏里并排出现。
 */
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { LibraryState } from '../../shared/library.js'
import type { LibraryComponentActions } from '../actions.js'
import { COLORS, triggerButtonStyle } from '../../../../shared/ui/styles.js'

/** 入口按钮的 props。 */
export interface LibraryTriggerProps {
  /** store 的读座位。 */
  useStore: SnapshotSelectorHook<LibraryState>
  /** store 的写座位。 */
  actions: LibraryComponentActions
  /** 会话标识；无会话时按钮禁用。 */
  sessionId?: string
}

/**
 * 入口按钮。
 * @param props - store 座位与会话标识。
 * @returns 按钮元素。
 */
export function LibraryTrigger({ useStore, actions, sessionId }: LibraryTriggerProps): ReactNode {
  const active = useStore(state => state.active)
  const disabled = sessionId === undefined
  return (
    <button
      type="button"
      data-structured-prompt-library-trigger=""
      data-dsh-prompt-trigger=""
      style={{
        ...triggerButtonStyle,
        borderColor: active ? COLORS.accent : COLORS.border,
        background: active ? COLORS.accentSoft : 'transparent',
        color: active ? COLORS.text : COLORS.textSecondary,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      title="提示词库：检索公开提示词库，预览后可直接发送"
      aria-haspopup="dialog"
      aria-expanded={active}
      disabled={disabled}
      onMouseDown={(event) => { event.preventDefault() }}
      onClick={() => actions.open()}
    >
      提示词库
    </button>
  )
}
