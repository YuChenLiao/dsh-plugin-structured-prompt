/**
 * `conversation.input.dock` 的占用者（提示词库组件）：按开关渲染检索弹窗。
 *
 * 与结构化组件的挂载点完全平行 —— 各自的条目、各自的 store、各自处理自己的 Esc。两个弹窗因此
 * 可以各自开合，互不干涉（拆分前它们共用一个 `library.active` 与一个条目）。
 *
 * hook 顺序：`useStore` 与 `useEffect` 必须在任何提前返回之前调用。
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { LibraryState } from '../../shared/library.js'
import type { LibraryComponentActions } from '../actions.js'
import { LibraryModal } from './LibraryModal.js'

/** 检索弹窗挂载点的 props。 */
export interface LibraryPanelProps {
  /** store 的读座位。 */
  useStore: SnapshotSelectorHook<LibraryState>
  /** store 的写座位。 */
  actions: LibraryComponentActions
  /** 把选中的原文作为一条用户消息投递进当前会话（由宿主注入）。 */
  onSend: (prompt: string) => void
  /** 会话标识；无会话时不渲染。 */
  sessionId?: string
}

/**
 * 检索弹窗挂载点。
 * @param props - store 座位、发送回调与会话标识。
 * @returns 弹窗，或未打开时的 `null`。
 */
export function LibraryPanel({
  useStore, actions, onSend, sessionId,
}: LibraryPanelProps): ReactNode {
  const library = useStore(state => state)

  // Esc 关闭弹窗；未打开时不挂监听。
  useEffect(() => {
    if (!library.active) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      actions.close()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [library.active, actions])

  if (!library.active || sessionId === undefined) return null

  return (
    <LibraryModal
      library={library}
      actions={actions}
      onClose={() => actions.close()}
      onSend={onSend}
    />
  )
}
