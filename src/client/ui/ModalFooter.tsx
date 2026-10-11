/**
 * 底部操作栏：模板、导入、导出、清空在左，「返回输入框」在右。
 *
 * 放在底部而不是标题栏：这些是低频、收尾类操作，常驻在滚动区之外既不会随内容
 * 滚动跑掉，也不会和标题行抢注意力。
 */
import type { ChangeEvent, ReactNode, RefObject } from 'react'
import type { PromptForm } from '../types.js'
import type { FormActions } from './actions.js'
import { SmallButton } from './base.js'
import { TEMPLATES } from '../templates.js'
import { COLORS, buttonStyle, modalFootStyle, rowStyle } from './styles.js'

/** 底部操作栏的 props。 */
export interface ModalFooterProps {
  /** store 动作（清空与模板填充）。 */
  actions: FormActions
  /** 导出回调。 */
  onExport: () => void
  /** 点击导入：交给隐藏的 file input。 */
  onImportClick: () => void
  /** 隐藏的 file input 引用（点击它与变更都由本组件触发）。 */
  importRef: RefObject<HTMLInputElement>  /** file input 变更回调。 */
  onImportChange: (event: ChangeEvent<HTMLInputElement>) => void
  /** 是否展开「返回输入框」的二选一。 */
  returnPrompt: boolean
  /** 切换二选一区域。 */
  onToggleReturn: () => void
}

/**
 * 底部操作栏。
 * @param props - 动作与回调。
 * @returns 底部栏元素。
 */
export function ModalFooter({
  actions, onExport, onImportClick, importRef, onImportChange, returnPrompt, onToggleReturn,
}: ModalFooterProps): ReactNode {
  return (
    <div style={modalFootStyle}>
      <div style={{ ...rowStyle, flexWrap: 'wrap' }}>
        <select
          style={{ ...buttonStyle, padding: '0 8px' }}
          value=""
          title="用内置模板填充表单"
          aria-label="用内置模板填充表单"
          onChange={(event) => {
            const picked = TEMPLATES.find(item => item.id === event.target.value)
            event.target.value = ''
            if (picked !== undefined) actions.setForm(picked.build() as Partial<PromptForm>)
          }}
        >
          <option value="">模板…</option>
          {TEMPLATES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <SmallButton title="从 JSON 导入表单" onClick={onImportClick}>导入</SmallButton>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onImportChange}
        />
        <SmallButton title="导出当前表单为 JSON" onClick={onExport}>导出</SmallButton>
        <SmallButton title="清空全部字段" onClick={() => actions.reset()}>清空</SmallButton>
      </div>
      <SmallButton
        title="返回输入框"
        style={{ borderColor: COLORS.borderStrong }}
        onClick={onToggleReturn}
      >
        {returnPrompt ? '收起返回选项' : '返回输入框'}
      </SmallButton>
    </div>
  )
}
