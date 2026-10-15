/**
 * 输入框底部工具栏里的两个入口按钮（`conversation.input.left`）。
 *
 * 只负责切换开关：置真后由同一 store 句柄驱动的弹窗渲染。两个按钮与弹窗共用实例，
 * 因此不需要任何跨注册的状态同步；两个开关在 store 里**互斥**（打开一个会关掉另一个）。
 *
 * 两个按钮放在同一个注册里（一个槽位条目），槽位与注册数量因此不变。
 */
import type { CSSProperties, ReactNode } from 'react'
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
 * 入口按钮组。
 * @param props - store 座位与会话标识。
 * @returns 两个按钮（表单 / 提示词库）。
 */
export function StructuredInputTrigger({
  useStore, actions, sessionId,
}: StructuredInputTriggerProps): ReactNode {
  const active = useStore(state => state.active)
  const libraryActive = useStore(state => state.library.active)
  const disabled = sessionId === undefined

  /**
   * 按钮外观：打开时高亮，无会话时降到禁用观感。
   * @param on - 该按钮对应的弹窗是否打开。
   * @returns 内联样式。
   */
  const look = (on: boolean): CSSProperties => ({
    ...triggerButtonStyle,
    borderColor: on ? COLORS.accent : COLORS.border,
    background: on ? COLORS.accentSoft : 'transparent',
    color: on ? COLORS.text : COLORS.textSecondary,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        data-structured-prompt-trigger=""
        style={look(active)}
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
      <button
        type="button"
        data-structured-prompt-library-trigger=""
        style={look(libraryActive)}
        title="提示词库：检索公开提示词库，预览后可直接发送"
        aria-haspopup="dialog"
        aria-expanded={libraryActive}
        disabled={disabled}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => actions.openLibrary()}
      >
        提示词库
      </button>
    </div>
  )
}
