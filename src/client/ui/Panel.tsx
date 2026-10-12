/**
 * `conversation.input.dock` 的占用者：按开关渲染表单弹窗。
 *
 * 未打开时返回 `null` 不占空间（入口按钮由 `StructuredInputTrigger` 负责）。Esc
 * 关闭弹窗，避免困在表单里。
 *
 * 发送经由宿主注入的 `onSend`：本组件不接触 `ctx`，也不假定输入框当前是否挂载
 * —— 决策与副作用都留在 `apply` 闭包里。
 *
 * hook 顺序：`useStore` 与 `useEffect` 都必须在任何提前返回**之前**调用 —— 开关会
 * 改变渲染分支，分支之后的 hook 会让数量随状态变化而抛错。
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { StructuredState } from '../../shared/types.js'
import type { FormActions } from './actions.js'
import { StructuredPromptModal } from './Modal.js'

/** 表单弹窗挂载点的 props。 */
export interface StructuredInputPanelProps {
  /** store 的读座位。 */
  useStore: SnapshotSelectorHook<StructuredState>
  /** store 的写座位。 */
  actions: FormActions
  /** 把成稿写入输入框并直接发送（由宿主注入）。 */
  onSend: (prompt: string) => void
  /** 会话标识；无会话时不渲染。 */
  sessionId?: string
}

/**
 * 表单弹窗挂载点。
 * @param props - store 座位、发送回调与会话标识。
 * @returns 弹窗，或未打开时的 `null`。
 */
export function StructuredInputPanel({
  useStore, actions, onSend, sessionId,
}: StructuredInputPanelProps): ReactNode {
  const active = useStore(state => state.active)
  const form = useStore(state => state.form)
  const collapsed = useStore(state => state.collapsed)

  // Esc 关闭弹窗；未打开时不挂监听。
  useEffect(() => {
    if (!active) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      actions.close()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [active, actions])

  if (!active || sessionId === undefined) return null

  return (
    <StructuredPromptModal
      form={form}
      collapsed={collapsed}
      actions={actions}
      onClose={() => actions.close()}
      onSend={onSend}
    />
  )
}
