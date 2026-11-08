/**
 * `conversation.input.dock` 的占用者（结构化组件）：按开关渲染表单弹窗。
 *
 * 未打开时返回 `null` 不占空间（入口按钮由 `StructuredInputTrigger` 负责）。Esc 关闭弹窗。
 * 提示词库是**另一个槽位条目**（`components/library/client/ui/Panel.tsx`），两者各开各的、
 * 互不干涉 —— 拆分前它们挤在同一个条目里。
 *
 * 这个容器留在输入区，即使表单已经改挂宿主的右侧栏 tab：它是
 *  - 「库 → 表单」交接的唯一订阅者（挂在输入区、始终挂载，tab 打开时也在）；
 *  - 侧栏不可用时的**降级外壳** —— 宿主没有 `sidebarRightTabs` 时，表单只能以弹窗出现，
 *    并在顶部说明原因（`degradeNote`）。
 *
 * 发送经由宿主注入的 `onSend`；扩写经由同源路由（宿主代跑子代理）。两者都是**副作用**，
 * 因此留在这个容器里（`panel-hooks.ts`）—— 弹窗组件只渲染状态，不碰网络。
 *
 * hook 顺序：`useStore` / `useEffect` / 自定义 hook 都必须在任何提前返回**之前**调用。
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { StructuredState } from '../../shared/types.js'
import { findTemplate } from '../../shared/templates.js'
import type { FormActions } from '../actions.js'
import { StructuredPromptModal } from './Modal.js'
import { useAssistRunner, useFormPatch } from './panel-hooks.js'
import type { Reveal } from './panel-hooks.js'

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
  /**
   * 揭示表单的另一个入口（宿主的右侧栏 tab）。
   *
   * 有它时「库 → 表单」优先开 tab；它返回 `false`（tab 开不成）才退回本弹窗。
   */
  onReveal?: Reveal
  /**
   * 降级原因：**每次渲染时求值**（不做成静态字符串）。
   *
   * 打开失败才产生内容，而失败会伴随一次 store 变更 —— 顺序正好：点击 → `open()` 返回 false →
   * `actions.open()` → 重渲染 → 这里拿到原因。宿主能力缺失与运行期打开失败因此共用一条通道。
   */
  degradeNote?: () => string | undefined
}

/**
 * 表单弹窗挂载点。
 * @param props - store 座位、发送回调、会话标识与降级信息。
 * @returns 弹窗，或未打开时的 `null`。
 */
export function StructuredInputPanel({
  useStore, actions, onSend, sessionId, onReveal, degradeNote,
}: StructuredInputPanelProps): ReactNode {
  const active = useStore(state => state.active)
  const form = useStore(state => state.form)
  const collapsed = useStore(state => state.collapsed)
  const appliedTemplate = useStore(state => state.appliedTemplate)
  const assist = useStore(state => state.assist)
  // id → 模板的解析在这里，而不是在 `Modal` 内部：模板来源属于数据层，界面组件只收结果。
  const applied = findTemplate(appliedTemplate)

  const runAssist = useAssistRunner({ form, assist, actions, sessionId })
  useFormPatch(actions, onReveal, sessionId)
  // 降级原因在这里求值：它依赖"刚才那次点击的结果"，静态字符串只能表达 apply 期的猜测。
  const note = degradeNote?.()

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
      applied={applied}
      actions={actions}
      onClose={() => actions.close()}
      onSend={onSend}
      assist={assist}
      onBriefChange={(brief) => actions.setAssistBrief(brief)}
      onAssist={runAssist}
      {...(note === undefined ? {} : { degradeNote: note })}
    />
  )
}
