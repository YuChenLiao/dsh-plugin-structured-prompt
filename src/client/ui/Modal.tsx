/**
 * 表单弹窗：标题栏 + 可滚动内容区 + 底部操作栏。
 *
 * 两条不变量在这里落地（并由离线测试断言）：
 *  - 只有内容区滚动：标题栏与底部操作栏 `flex: none` 常驻，滚动条只出现在内容区
 *    右侧；
 *  - 点遮罩**不关闭**：遮罩不绑定点击处理器，避免误触丢掉已填内容；关闭只经由
 *    标题栏的 `×` 或 Esc。
 *
 * （第三条不变量在 `styles.ts`：分组容器既不裁剪也不压缩。）
 *
 * 主要动作是「复制」（成稿进剪贴板）与「发送」（把成稿投递进当前会话）；不提供
 * 「同步并返回」这类中间态 —— 要么复制走，要么直接发出去。
 */
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { PromptForm } from '../../shared/types.js'
import type { FormActions } from './actions.js'
import { SmallButton } from './base.js'
import { CollapsibleSection } from './CollapsibleSection.js'
import { ModalFooter } from './ModalFooter.js'
import type { Notice } from './ModalFooter.js'
import { Preview } from './Preview.js'
import { copyText } from './clipboard.js'
import { SECTIONS } from './config.js'
import { BasicSection } from './sections/BasicSection.js'
import { OutputSection } from './sections/OutputSection.js'
import { RulesSection } from './sections/RulesSection.js'
import { ToolsSection } from './sections/ToolsSection.js'
import { parseFormDocument, serializeForm } from '../../shared/forms.js'
import { buildSystemPromptSections, renderPrompt, validateForm } from '../../shared/prompt.js'
import {
  COLORS,
  maskStyle,
  modalBodyStyle,
  modalHeadStyle,
  modalStyle,
  rowStyle,
} from './styles.js'

/** 提示的展示时长（ms）。 */
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
  /** 把成稿作为一条用户消息投递进当前会话。 */
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
  const [notice, setNotice] = useState<Notice | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 卸载时清掉未触发的提示定时器，避免在已卸载组件上 setState。
  useEffect(() => () => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
  }, [])

  // 分段与全文只算一次：分段供预览显示逐段预算，全文供复制/发送。
  const sections = buildSystemPromptSections(form)
  const prompt = renderPrompt(sections)
  const missing = validateForm(form)
  const canSend = missing.length === 0 && prompt !== ''

  /**
   * 显示一次性提示。
   * @param kind - 成功或失败。
   * @param text - 提示文案。
   */
  const showNotice = (kind: Notice['kind'], text: string): void => {
    setNotice({ kind, text })
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), COPY_HINT_MS)
  }

  /** 复制成稿到剪贴板，并短暂显示结果。 */
  const copyPrompt = (): void => {
    void copyText(prompt).then((ok) => {
      showNotice(ok ? 'ok' : 'failed', ok ? '已复制' : '复制失败')
    })
  }

  /** 发送：把成稿作为一条用户消息投递进当前会话，然后关闭弹窗。 */
  const send = (): void => {
    if (!canSend) return
    onSend(prompt)
    onClose()
  }

  /** 导出当前表单为 JSON 文档（含 schema 版本号），便于在别的会话复用。 */
  const exportForm = (): void => {
    try {
      const text = JSON.stringify(serializeForm(form), null, 2)
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'structured-prompt-form.json'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('[structured-prompt] 导出表单失败：', error)
      showNotice('failed', '导出失败')
    }
  }

  /** 从用户选择的 JSON 文件导入表单。 */
  const importForm = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    void file.text().then((text: string) => {
      try {
        const parsed = parseFormDocument(text)
        // 空 patch 一律拒绝导入：`setForm` 是整体替换，拿一个空对象覆盖等于把用户已填
        // 的内容清掉 —— 而"文件里没有可识别的字段"本就不该被视为一次成功的导入。
        if (Object.keys(parsed.patch).length === 0) {
          showNotice('failed', '文件里没有可识别的字段，表单未改动')
          return
        }
        actions.setForm(parsed.patch)
        if (parsed.warnings.length > 0) {
          // 部分内容被忽略时要说出来，否则"导入成功但字段没变"会让人以为是坏掉了。
          console.warn('[structured-prompt] 导入时忽略了部分内容：', parsed.warnings)
          showNotice('ok', `已导入（忽略 ${parsed.warnings.length} 项）`)
        } else {
          showNotice('ok', '已导入')
        }
      } catch (error) {
        console.error('[structured-prompt] 导入表单失败：', error)
        showNotice('failed', `导入失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }).catch((error: unknown) => {
      console.error('[structured-prompt] 读取文件失败：', error)
      showNotice('failed', '读取文件失败')
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

          <Preview prompt={prompt} sections={sections} />
        </div>

        <ModalFooter
          actions={actions}
          onExport={exportForm}
          onImportClick={() => importRef.current?.click()}
          importRef={importRef}
          onImportChange={importForm}
          onCopy={copyPrompt}
          notice={notice}
          onSend={send}
          canSend={canSend}
        />
      </div>
    </div>
  )
}
