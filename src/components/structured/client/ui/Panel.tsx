/**
 * `conversation.input.dock` 的占用者（结构化组件）：按开关渲染表单弹窗。
 *
 * 未打开时返回 `null` 不占空间（入口按钮由 `StructuredInputTrigger` 负责）。Esc 关闭弹窗。
 * 提示词库是**另一个槽位条目**（`components/library/client/ui/Panel.tsx`），两者各开各的、
 * 互不干涉 —— 拆分前它们挤在同一个条目里。
 *
 * 发送经由宿主注入的 `onSend`；自动填充经由同源路由（宿主代跑子代理）。两者都是**副作用**，
 * 因此留在这个容器里 —— 弹窗组件只渲染状态，不碰网络。
 *
 * hook 顺序：`useStore` / `useRef` / `useEffect` 都必须在任何提前返回**之前**调用。
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { StructuredState } from '../../shared/types.js'
import { findTemplate } from '../../shared/templates.js'
import { requestAssist } from '../assist.js'
import { onFormPatch } from '../../../../shared/assist-bridge.js'
import type { FormActions } from '../actions.js'
import { StructuredPromptModal } from './Modal.js'

/** 表单弹窗挂载点的 props。 */
export interface StructuredInputPanelProps {
  /** store 的读座位。 */
  useStore: SnapshotSelectorHook<StructuredState>
  /** store 的写座位。 */
  actions: FormActions
  /** 把成稿作为一条用户消息投递进当前会话（由宿主注入）。 */
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
  const appliedTemplate = useStore(state => state.appliedTemplate)
  const assist = useStore(state => state.assist)
  // id → 模板的解析在这里，而不是在 `Modal` 内部：模板来源属于数据层，界面组件只收结果。
  const applied = findTemplate(appliedTemplate)

  // 自动填充的请求序号：只有最后一次发起的结果能落进表单（与库检索同一套防错位手法 ——
  // 连点两次时，慢的那个响应不该覆盖新的一次）。
  const assistSeq = useRef(0)

  // 接收提示词库那边交过来的补丁（"转化为表单"）：合并进当前表单并打开弹窗。
  // 用一次性事件而不是共享状态 —— 收不到就丢掉，不留下需要清理的残留。
  useEffect(() => onFormPatch((patch) => {
    actions.mergeForm(patch)
    // 转化结果不是"套用模板"：套用标记要清掉，否则场景条会声称表单来自某套内置模板。
    actions.setAppliedTemplate('')
    actions.patchAssist({ status: 'done', error: '', warnings: [] })
    actions.open()
  }), [actions])

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

  /**
   * 请宿主跑一次扩写，把结果补丁落进表单。
   *
   * 三重防护：进行中不再发（防连点）、内容为空不发、序号不符的响应直接丢弃。
   */
  const runAssist = (): void => {
    if (assist.status === 'running') return
    const brief = assist.brief.trim()
    if (brief === '' || sessionId === undefined) return
    assistSeq.current += 1
    const seq = assistSeq.current
    actions.patchAssist({ status: 'running', error: '', warnings: [] })
    // 带上当前表单：宿主会转给子代理，避免把用户已经填好的字段清掉。
    void requestAssist({ action: 'expand', brief, current: form }, sessionId).then((result) => {
      if (seq !== assistSeq.current) return
      if (!result.ok) {
        actions.patchAssist({ status: 'failed', error: result.error })
        return
      }
      // 只合并模型给到的字段：用 setForm 会把用户已填、而模型没返回的字段清空。
      actions.mergeForm(result.value.patch)
      // 扩写不是"套用模板"：套用标记必须清掉，否则场景条会声称表单来自某套内置模板。
      actions.setAppliedTemplate('')
      // 成功时一并清掉上一次失败的 error，否则它会和成功提示同时显示。
      actions.patchAssist({ status: 'done', error: '', warnings: [...result.value.warnings] })
    })
  }

  if (!active || sessionId === undefined) return null

  return (
    <StructuredPromptModal
      form={form}
      collapsed={collapsed}
      applied={applied}
      actions={actions}
      onClose={() => actions.close()}
      onSend={onSend}
      assist={assist}
      onBriefChange={(brief) => actions.setAssistBrief(brief)}
      onAssist={runAssist}
    />
  )
}
