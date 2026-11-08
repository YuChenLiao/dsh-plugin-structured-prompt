/**
 * 表单弹窗：遮罩 + 尺寸 + `<FormPanel>`。
 *
 * 拆开之后这里只负责"弹窗这件事"：遮罩、按列测量、`fixed` 包含块补偿、尺寸与 dialog 语义。
 * 表单本体在 `FormPanel.tsx`，同一份也挂在宿主的右侧栏 tab 上（侧栏不需要测量，宿主给多少
 * 地方就用多少）。
 *
 * 定位的两层机制（真机踩出来的，别简化）：
 *  1. 基准是「第一个够宽的祖先」—— 工具栏/浮层这类局部容器全都比视口窄，取第一个命中的会贴着
 *     它们（现象：空会话居中正常，一有对话就偏右）；
 *  2. `position: fixed` 的包含块未必是视口 —— 祖先带 `transform` 时 `left` 相对它，偏移会被
 *     叠加一次（实测 `left: 0` 渲染成 `rect.left = 280`）。`useDialogFrame` 会量出原点并补偿。
 *
 * 点遮罩**不关闭**：不绑定点击处理器，避免误触丢掉已填内容；关闭只经由标题栏的 `×` 或 Esc。
 */
import { useRef } from 'react'
import type { ReactNode } from 'react'
import type { PromptForm, PromptTemplate } from '../../shared/types.js'
import type { AssistState } from '../../shared/types.js'
import type { FormActions } from '../actions.js'
import { FormPanel } from './FormPanel.js'
import s from '../../../../shared/ui/panel.module.css'
import { frameAnchor, useDialogFrame } from '../../../../shared/ui/use-dialog-frame.js'

/** 弹窗的 props。 */
export interface StructuredPromptModalProps {
  /** 表单字段。 */
  form: PromptForm
  /** 已折叠的分组 id。 */
  collapsed: readonly string[]
  /** 当前表单套用的模板；未套用或解析不到时为 `undefined`。 */
  applied: PromptTemplate | undefined
  /** store 动作。 */
  actions: FormActions
  /** 关闭弹窗。 */
  onClose: () => void
  /** 把成稿作为一条用户消息投递进当前会话。 */
  onSend: (prompt: string) => void
  /** 自动填充的状态。 */
  assist: AssistState
  /** 改写那句话需求。 */
  onBriefChange: (brief: string) => void
  /** 请宿主跑一次扩写。 */
  onAssist: () => void
  /** 降级说明：宿主没有右侧栏 tab 能力时，交给表单本体显示在顶部。 */
  degradeNote?: string
}

/**
 * 表单弹窗。
 * @param props - 表单、折叠状态、套用标记、动作与回调。
 * @returns 弹窗元素。
 */
export function StructuredPromptModal({
  form, collapsed, applied, actions, onClose, onSend, assist, onBriefChange, onAssist, degradeNote,
}: StructuredPromptModalProps): ReactNode {
  const maskRef = useRef<HTMLDivElement>(null)
  // 遮罩按弹窗所在的列居中（右栏开合会自动跟随），见 useDialogFrame。
  const dialogFrame = useDialogFrame(maskRef)

  return (
    <div
      ref={maskRef}
      data-dsh-prompt-mask=""
      // 自证锚点：`column:<left>/<width>` 表示按那一列定位并给出实际数值；`viewport` 表示退回整视口。
      // 真实布局离线测不了，出问题时用它一眼区分"没生效"与"生效了但期望不同"。
      data-dsh-prompt-frame={frameAnchor(dialogFrame)}
      className={s.mask}
      style={dialogFrame}
      role="presentation"
      // 刻意不绑定 onClick：点遮罩属于误触高发区，已填内容不该因此丢失。
    >
      <div
        data-structured-prompt-modal=""
        className={s.modal}
        role="dialog"
        aria-modal
        aria-label="结构化输入任务"
      >
        <FormPanel
          form={form}
          collapsed={collapsed}
          applied={applied}
          actions={actions}
          onClose={onClose}
          onSend={onSend}
          assist={assist}
          onBriefChange={onBriefChange}
          onAssist={onAssist}
          {...(degradeNote === undefined ? {} : { degradeNote })}
        />
      </div>
    </div>
  )
}
