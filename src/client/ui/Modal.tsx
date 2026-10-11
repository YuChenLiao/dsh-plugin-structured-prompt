/**
 * 表单弹窗：标题栏 + 可滚动内容区 + 底部操作栏。
 *
 * 三个不变量在这里落地（并由离线测试断言）：
 *  - 只有内容区滚动：标题栏与底部操作栏 `flex: none` 常驻，滚动条只出现在内容区
 *    右侧；
 *  - 点遮罩**不关闭**：遮罩不绑定点击处理器，避免误触丢掉已填内容；关闭只经由
 *    标题栏的 ×、底部「返回输入框」或 Esc。
 */
import { useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { PromptForm, StructuredState } from '../types.js'
import type { FormActions } from './actions.js'
import { SmallButton } from './base.js'
import { CollapsibleSection } from './CollapsibleSection.js'
import { ModalFooter } from './ModalFooter.js'
import { Preview } from './Preview.js'
import { ReturnPromptBar } from './ReturnPromptBar.js'
import { SECTIONS } from './config.js'
import { BasicSection } from './sections/BasicSection.js'
import { OutputSection } from './sections/OutputSection.js'
import { RulesSection } from './sections/RulesSection.js'
import { ToolsSection } from './sections/ToolsSection.js'
import { buildSystemPrompt, validateForm } from '../prompt.js'
import {
  COLORS,
  maskStyle,
  modalBodyStyle,
  modalHeadStyle,
  modalStyle,
  rowStyle,
} from './styles.js'

/** 弹窗的 props。 */
export interface StructuredPromptModalProps {
  /** 表单字段。 */
  form: PromptForm
  /** 已折叠的分组 id。 */
  collapsed: readonly string[]
  /** store 动作。 */
  actions: FormActions
  /** 写入输入框草稿。 */
  setDraft: (text: string) => void
  /** 会话标识（仅用于渲染判断，弹窗本身不请求数据）。 */
  sessionId: string
  /** 关闭弹窗。 */
  onClose: () => void
}

/**
 * 表单弹窗。
 * @param props - 表单、折叠状态、动作与关闭回调。
 * @returns 弹窗元素。
 */
export function StructuredPromptModal({
  form, collapsed, actions, setDraft, sessionId, onClose,
}: StructuredPromptModalProps): ReactNode {
  const [returnPrompt, setReturnPrompt] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const prompt = buildSystemPrompt(form)
  const missing = validateForm(form)
  const canSync = missing.length === 0 && prompt !== ''

  /** 关闭弹窗并复位返回确认条。 */
  const close = (): void => {
    setReturnPrompt(false)
    onClose()
  }

  /** 「同步并返回」：先写入草稿，再关闭。 */
  const syncAndClose = (): void => {
    if (!canSync) return
    setDraft(prompt)
    close()
  }

  /** 导出当前表单为 JSON，便于在别的会话复用。 */
  const exportForm = (): void => {
    try {
      const blob = new Blob([JSON.stringify(form, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'structured-prompt-form.json'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('[structured-prompt] 导出表单失败：', error)
    }
  }

  /** 从用户选择的 JSON 文件导入表单。 */
  const importForm = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    void file.text().then((text: string) => {
      actions.setForm(JSON.parse(text) as Partial<PromptForm>)
    }).catch((error: unknown) => {
      console.error('[structured-prompt] 导入表单失败：', error)
    })
  }

  /** 分组 id → 渲染器。新增分组时这里与 `config.ts` 的 SECTIONS 同步扩展。 */
  const renderers: Record<string, () => ReactNode> = {
    basic: () => <BasicSection form={form} actions={actions} />,
    rules: () => <RulesSection form={form} actions={actions} />,
    tools: () => <ToolsSection form={form} actions={actions} />,
    output: () => <OutputSection form={form} actions={actions} />,
  }

  return (
    <div
      style={maskStyle}
      role="presentation"
      // 刻意不绑定 onClick：点遮罩属于误触高发区，已填内容不该因此丢失。
    >
      <div
        data-structured-prompt-modal=""
        style={modalStyle}
        role="dialog"
        aria-modal
        aria-label="结构化输入任务"
        // 会话切换时重置本地 UI 状态（返回确认条），避免带到新会话。
        key={sessionId}
      >
        <div style={modalHeadStyle}>
          <div style={{ ...rowStyle, flex: '1 1 auto', minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>结构化输入任务</span>
            {missing.length > 0
              ? (
                <span style={{ color: COLORS.caption, fontSize: 12 }}>
                  {`还差必填：${missing.join('、')}`}
                </span>
              )
              : null}
          </div>
          <SmallButton
            title="关闭（不改动输入框内容）"
            ariaLabel="关闭"
            style={{ minWidth: 28, padding: '0 6px', fontSize: 14, lineHeight: 1 }}
            onClick={close}
          >
            ×
          </SmallButton>
        </div>

        <div data-scroll="" style={modalBodyStyle}>
          {returnPrompt
            ? (
              <ReturnPromptBar
                canSync={canSync}
                onSyncAndClose={syncAndClose}
                onCloseWithoutSync={close}
              />
            )
            : null}

          {SECTIONS.map((section) => {
            const render = renderers[section.id]
            if (render === undefined) return null
            return (
              <CollapsibleSection
                key={section.id}
                meta={section}
                collapsed={collapsed.includes(section.id)}
                onToggle={() => actions.toggleSection(section.id)}
              >
                {render()}
              </CollapsibleSection>
            )
          })}

          <Preview prompt={prompt} />
        </div>

        <ModalFooter
          actions={actions}
          onExport={exportForm}
          onImportClick={() => importRef.current?.click()}
          importRef={importRef}
          onImportChange={importForm}
          returnPrompt={returnPrompt}
          onToggleReturn={() => setReturnPrompt(value => !value)}
        />
      </div>
    </div>
  )
}

/** 供面板组件透传的状态片段。 */
export type ModalState = Pick<StructuredState, 'form' | 'collapsed'>
