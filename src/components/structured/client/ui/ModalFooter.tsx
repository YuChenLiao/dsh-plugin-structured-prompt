/**
 * 底部操作栏。
 *
 * 布局：左侧是表单级工具（模板、导入、导出、清空），右侧是本插件的主要动作
 * ——「复制」（把成稿放进剪贴板）与「发送」（作为一条用户消息投递进当前会话）。
 *
 * 关闭不在这里：标题栏的 `×` 与 Esc 已经覆盖，底部再放一个只是重复。
 */
import type { ChangeEvent, ReactNode, RefObject } from 'react'
import type { PromptForm } from '../../shared/types.js'
import type { FormActions } from '../actions.js'
import { SmallButton } from '../../../../shared/ui/base.js'
import { TEMPLATES, findTemplate } from '../../shared/templates.js'
import { COLORS, buttonStyle, modalFootStyle, primaryButtonStyle, rowStyle } from '../../../../shared/ui/styles.js'

/** 底部操作栏的一次性提示。 */
export interface Notice {
  /** `ok` 用次要文字色，`failed` 用错误色。 */
  readonly kind: 'ok' | 'failed'
  /** 提示文案。 */
  readonly text: string
}

/** 底部操作栏的 props。 */
export interface ModalFooterProps {
  /** store 动作（清空与模板填充）。 */
  actions: FormActions
  /** 导出回调。 */
  onExport: () => void
  /** 点击导入：交给隐藏的 file input。 */
  onImportClick: () => void
  /** 隐藏的 file input 引用。 */
  importRef: RefObject<HTMLInputElement>
  /** file input 变更回调。 */
  onImportChange: (event: ChangeEvent<HTMLInputElement>) => void
  /** 复制成稿到剪贴板。 */
  onCopy: () => void
  /** 一次性提示（复制结果、导入结果）；无提示时为 `null`。 */
  notice: Notice | null
  /** 把成稿投递进当前会话。 */
  onSend: () => void
  /** 成稿是否可用（身份与目标已填）。 */
  canSend: boolean
}

/**
 * 底部操作栏。
 * @param props - 动作与状态。
 * @returns 底部栏元素。
 */
export function ModalFooter({
  actions, onExport, onImportClick, importRef, onImportChange, onCopy, notice, onSend, canSend,
}: ModalFooterProps): ReactNode {
  return (
    <div style={modalFootStyle}>
      <div style={{ ...rowStyle, flexWrap: 'wrap' }}>
        <select
          // `maxWidth` 是必要的：**选项文本本身**带了场景说明，不加约束时最长的选项会把这一
          // 行撑开、把导入/导出/清空挤下去；收起时宽度受限，展开的列表里仍能看到完整文案。
          // （下面的 `title` 不是展示路径 —— 浏览器不据此渲染 option 提示，它只是辅助技术的
          // 兜底；场景的展示靠选项文本本身。）
          style={{ ...buttonStyle, padding: '0 8px', maxWidth: 260 }}
          value=""
          title="用内置模板填充表单"
          aria-label="用内置模板填充表单"
          onChange={(event) => {
            // 解析走 `findTemplate`（与 host 侧、`Panel` 同一处），不在这里另查一次表 ——
            // 否则"再加一层模板来源"时，用户唯一能选模板的入口不会跟着变。
            const picked = findTemplate(event.target.value)
            event.target.value = ''
            if (picked === undefined) return
            actions.setForm(picked.build() as Partial<PromptForm>)
            // 套用标记只驱动界面上的场景条，不参与提示词构建（见 `StructuredState`）。
            actions.setAppliedTemplate(picked.id)
          }}
        >
          <option value="">模板…</option>
          {TEMPLATES.map(item => (
            <option key={item.id} value={item.id} title={item.whenToUse}>
              {`${item.label} · ${item.whenToUse}`}
            </option>
          ))}
        </select>
        <SmallButton title="从 JSON 导入表单（也接受无版本号的旧导出文件）" onClick={onImportClick}>导入</SmallButton>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onImportChange}
        />
        <SmallButton title="导出当前表单为 JSON（含 schema 版本号）" onClick={onExport}>导出</SmallButton>
        <SmallButton title="清空全部字段" onClick={() => actions.reset()}>清空</SmallButton>
      </div>

      <div style={{ ...rowStyle, flexWrap: 'wrap' }}>
        {notice === null ? null : (
          <span
            role="status"
            style={{ fontSize: 12, color: notice.kind === 'ok' ? COLORS.textSecondary : COLORS.danger }}
          >
            {notice.text}
          </span>
        )}
        <SmallButton
          title={canSend ? '复制构建好的提示词到剪贴板' : '身份与目标为必填'}
          disabled={!canSend}
          onClick={onCopy}
        >
          复制
        </SmallButton>
        <button
          type="button"
          style={{
            ...primaryButtonStyle,
            opacity: canSend ? 1 : 0.5,
            cursor: canSend ? 'pointer' : 'not-allowed',
          }}
          disabled={!canSend}
          title={canSend ? '把提示词投递进当前会话' : '身份与目标为必填'}
          onClick={onSend}
        >
          发送
        </button>
      </div>
    </div>
  )
}
