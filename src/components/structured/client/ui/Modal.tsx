/**
 * 表单弹窗：标题栏 + 可滚动内容区 + 底部操作栏。
 *
 * 两条不变量在这里落地（离线测试断言）：只有内容区滚动（标题栏与底栏 `flex: none`）、
 * 点遮罩**不关闭**（关闭只经由 `×` 或 Esc，避免误触丢掉已填内容）。第三条不变量在
 * `shared/ui/panel.module.css`：分组容器既不裁剪也不压缩。
 *
 * 主要动作是「复制」与「发送」；不提供「同步并返回」这类中间态 —— 要么复制走，要么直接发出去。
 */
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { AssistState, PromptForm, PromptTemplate } from '../../shared/types.js'
import type { FormActions } from '../actions.js'
import { SmallButton } from '../../../../shared/ui/base.js'
import { AssistRow } from './AssistRow.js'
import { CollapsibleSection } from './CollapsibleSection.js'
import { ModalFooter } from './ModalFooter.js'
import type { Notice } from './ModalFooter.js'
import { Preview } from './Preview.js'
import { copyText } from '../../../../shared/ui/clipboard.js'
import { SECTIONS } from './config.js'
import { BasicSection } from './sections/BasicSection.js'
import { OutputSection } from './sections/OutputSection.js'
import { RulesSection } from './sections/RulesSection.js'
import { ToolsSection } from './sections/ToolsSection.js'
import { parseFormDocument, serializeForm } from '../../shared/forms.js'
import { buildSystemPromptSections, renderPrompt, validateForm } from '../../shared/prompt.js'
// 样式在 CSS Modules 里（构建期 hash 化 + 自动注入），组件只引用类名。
import s from '../../../../shared/ui/panel.module.css'
import { useDialogFrame } from '../../../../shared/ui/use-dialog-frame.js'

/** 提示的展示时长（ms）。 */
const COPY_HINT_MS = 1800

/** 弹窗的 props。 */
export interface StructuredPromptModalProps {
  /** 表单字段。 */
  form: PromptForm
  /** 已折叠的分组 id。 */
  collapsed: readonly string[]
  /** 当前表单套用的模板；未套用或解析不到时为 `undefined`（id → 模板的解析在容器里做）。 */
  applied: PromptTemplate | undefined
  /** store 动作。 */
  actions: FormActions
  /** 关闭弹窗。 */
  onClose: () => void
  /** 把成稿作为一条用户消息投递进当前会话。 */
  onSend: (prompt: string) => void
  /** 自动填充的状态（一句话需求、进行中、结果说明）。 */
  assist: AssistState
  /** 改写那句话需求。 */
  onBriefChange: (brief: string) => void
  /** 请宿主跑一次扩写。 */
  onAssist: () => void
}

/**
 * 表单弹窗。
 * @param props - 表单、折叠状态、套用标记、动作与回调。
 * @returns 弹窗元素。
 */
export function StructuredPromptModal({
  form, collapsed, applied, actions, onClose, onSend, assist, onBriefChange, onAssist,
}: StructuredPromptModalProps): ReactNode {
  const [notice, setNotice] = useState<Notice | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const maskRef = useRef<HTMLDivElement>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 遮罩按弹窗所在的列居中（右栏开合会自动跟随），见 useDialogFrame。
  const dialogFrame = useDialogFrame(maskRef)

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
        // 导入替换了整份表单：套用标记随之失效，否则场景条会继续声称表单来自某套模板。
        actions.setAppliedTemplate('')
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
      ref={maskRef}
      data-dsh-prompt-mask=""
      // 自证锚点：`column` = 定位已按那一列生效；`viewport` = 退回整视口居中。
      // 真实布局离线测不了，出问题时用它一眼区分"没生效"与"生效了但期望不同"。
      data-dsh-prompt-frame={Object.keys(dialogFrame).length === 0 ? 'viewport' : 'column'}
      className={s.mask}
      style={dialogFrame}
      role="presentation"
      // 刻意不绑定 onClick：点遮罩属于误触高发区，已填内容不该因此丢失。
    >
      <div
        data-structured-prompt-modal=""
        data-dsh-prompt-panel=""
        className={s.modal}
        role="dialog"
        aria-modal
        aria-label="结构化输入任务"
      >
        <div className={s.modalHead}>
          <div className={s.modalHeadTitle}>
            <span className={s.modalTitle}>结构化输入任务</span>
            {missing.length > 0
              ? (
                <span className={s.modalHint}>
                  {`还差必填：${missing.join('、')}`}
                </span>
              )
              : null}
          </div>
          <SmallButton
            title="关闭（不改动输入框内容）"
            ariaLabel="关闭"
            className={s.iconButton}
            onClick={onClose}
          >
            ×
          </SmallButton>
        </div>

        <div data-scroll="" className={s.modalBody}>
          {/* 自动填充：一句话 → 字段。请求由带 `sessionId` 的容器发起，本组件只渲染状态 ——
              与「复制 / 发送」的分工一致，网络与 store 副作用都不在这里。 */}
          <AssistRow assist={assist} onBriefChange={onBriefChange} onAssist={onAssist} />
          {applied === undefined ? null : (
            // 场景条是**表单状态的陈述**（这份表单来自哪套模板），不是一次性提示：它会一直
            // 显示到用户改套用别的模板、导入或清空。`data-applied-template` 是给渲染测试
            // 用的锚点 —— 提示文案里的字样在预览区里也会出现，靠文本定位区分不开。
            <p
              // `note` 而不是 `status`：场景条是持久的状态陈述，不是需要播报的瞬时提示 ——
              // 底部栏的 notice 已经占了 live region，同页再来一个只会变噪音。
              role="note"
              data-applied-template=""
              className={s.modalNote}
            >
              {`已套用模板「${applied.label}」：${applied.whenToUse}。模板里的目标是形态化的，请把本次的具体任务写进「目标」。`}
            </p>
          )}
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
