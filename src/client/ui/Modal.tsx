/**
 * 表单弹窗：标题栏 + 可滚动内容区 + 底部操作栏。
 *
 * 三个不变量在这里落地（并由离线测试断言）：
 *  - 只有内容区滚动：标题栏与底部操作栏 `flex: none` 常驻，滚动条只出现在内容区
 *    右侧；
 *  - 点遮罩**不关闭**：遮罩不绑定点击处理器，避免误触丢掉已填内容；关闭只经由
 *    标题栏的 `×` 或 Esc。
 *
 * 主要动作是「复制」（成稿进剪贴板）与「发送」（把成稿投递进当前会话）；不提供
 * 「同步并返回」这类中间态 —— 要么复制走，要么直接发出去。
 */
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { PromptForm } from '../types.js'
import type { FormActions } from './actions.js'
import { SmallButton } from './base.js'
import { CollapsibleSection } from './CollapsibleSection.js'
import { ModalFooter } from './ModalFooter.js'
import { Preview } from './Preview.js'
import { copyText } from './clipboard.js'
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

/** 复制结果提示的展示时长（ms）。 */
const COPY_HINT_MS = 1800

/** 弹窗的 props。 */
export interface StructuredPromptModalProps {
  /** 表单字段。 */
  form: PromptForm
  /** 已折叠的分组 id。 */
  collapsed: readonly string[]
  /** store 动作。 */
  actions: FormActions
  /** 关闭弹窗。 */
  onClose: () => void
  /** 把成稿写入输入框并直接发送。 */
  onSend: (prompt: string) => void
}

/**
 * 表单弹窗。
 * @param props - 表单、折叠状态、动作与回调。
 * @returns 弹窗元素。
 */
export function StructuredPromptModal({
  form, collapsed, actions, onClose, onSend,
}: StructuredPromptModalProps): ReactNode {
  const [copyState, setCopyState] = useState<'ok' | 'failed' | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 卸载时清掉未触发的提示定时器，避免在已卸载组件上 setState。
  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])

  const prompt = buildSystemPrompt(form)
  const missing = validateForm(form)
  const canSend = missing.length === 0 && prompt !== ''

  /** 复制成稿到剪贴板，并短暂显示结果。 */
  const copyPrompt = (): void => {
    void copyText(prompt).then((ok) => {
      setCopyState(ok ? 'ok' : 'failed')
      if (copyTimer.current !== null) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopyState(null), COPY_HINT_MS)
    })
  }

  /** 发送：把成稿交给宿主写入输入框并提交，然后关闭弹窗。 */
  const send = (): void => {
    if (!canSend) return
    onSend(prompt)
    onClose()
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
            onClick={onClose}
          >
            ×
          </SmallButton>
        </div>

        <div data-scroll="" style={modalBodyStyle}>
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
          onCopy={copyPrompt}
          copyState={copyState}
          onSend={send}
          canSend={canSend}
        />
      </div>
    </div>
  )
}
