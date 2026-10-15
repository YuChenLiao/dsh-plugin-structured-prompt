/**
 * `conversation.input.dock` 的占用者：按开关渲染两个弹窗之一。
 *
 * 未打开时返回 `null` 不占空间（入口按钮由 `StructuredInputTrigger` 负责）。Esc 关闭当前
 * 打开的那个，避免困在里面。
 *
 * 发送经由宿主注入的 `onSend`：本组件不接触 `ctx`，也不假定输入框当前是否挂载
 * —— 决策与副作用都留在 `apply` 闭包里。两个弹窗共用同一条发送链路（`conversation.send`）。
 *
 * hook 顺序：`useStore` 与 `useEffect` 都必须在任何提前返回**之前**调用 —— 开关会
 * 改变渲染分支，分支之后的 hook 会让数量随状态变化而抛错。
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { StructuredState } from '../../shared/types.js'
import { findTemplate } from '../../shared/templates.js'
import type { FormActions } from './actions.js'
import { LibraryModal } from './LibraryModal.js'
import { StructuredPromptModal } from './Modal.js'

/** 弹窗挂载点的 props。 */
export interface StructuredInputPanelProps {
  /** store 的读座位。 */
  useStore: SnapshotSelectorHook<StructuredState>
  /** store 的写座位。 */
  actions: FormActions
  /** 把成稿/选中的提示词作为一条用户消息投递进当前会话（由宿主注入）。 */
  onSend: (prompt: string) => void
  /** 会话标识；无会话时不渲染。 */
  sessionId?: string
}

/**
 * 弹窗挂载点。
 * @param props - store 座位、发送回调与会话标识。
 * @returns 检索弹窗、表单弹窗，或都未打开时的 `null`。
 */
export function StructuredInputPanel({
  useStore, actions, onSend, sessionId,
}: StructuredInputPanelProps): ReactNode {
  const active = useStore(state => state.active)
  const form = useStore(state => state.form)
  const collapsed = useStore(state => state.collapsed)
  const appliedTemplate = useStore(state => state.appliedTemplate)
  const library = useStore(state => state.library)
  // id → 模板的解析在这里，而不是在 `Modal` 内部：模板来源属于数据层，界面组件只收结果。
  // 将来接入本机自定义模板时改这一处即可 —— `Modal` 的 props 与渲染都不用动。
  const applied = findTemplate(appliedTemplate)

  // Esc 关闭当前打开的弹窗；两个都没开时不挂监听。
  useEffect(() => {
    if (!active && !library.active) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (library.active) actions.closeLibrary()
      else actions.close()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [active, library.active, actions])

  if (sessionId === undefined) return null
  if (library.active) {
    return (
      <LibraryModal
        library={library}
        actions={actions}
        onClose={() => actions.closeLibrary()}
        onSend={onSend}
      />
    )
  }
  if (!active) return null

  return (
    <StructuredPromptModal
      form={form}
      collapsed={collapsed}
      applied={applied}
      actions={actions}
      onClose={() => actions.close()}
      onSend={onSend}
    />
  )
}
