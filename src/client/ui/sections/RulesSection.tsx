/**
 * 「约束与规则」分组：硬性规则 + 禁止行为。
 *
 * 两个字段都是逐条编辑的数组，分别渲染为编号列表与子块（见 `prompt.ts`）。
 */
import type { ReactNode } from 'react'
import type { PromptForm } from '../../types.js'
import type { FormActions } from '../actions.js'
import { ListEditor } from '../ListEditor.js'
import { LIST_FIELDS } from '../config.js'

/** 约束与规则分组的 props。 */
export interface RulesSectionProps {
  /** 表单。 */
  form: PromptForm
  /** store 动作。 */
  actions: FormActions
}

/**
 * 约束与规则分组。
 * @param props - 表单与动作。
 * @returns 字段组。
 */
export function RulesSection({ form, actions }: RulesSectionProps): ReactNode {
  const rules = LIST_FIELDS['rules']
  const forbidden = LIST_FIELDS['forbidden']
  return (
    <>
      {rules === undefined ? null : (
        <ListEditor field={rules} items={form.rules} actions={actions} />
      )}
      {forbidden === undefined ? null : (
        <ListEditor field={forbidden} items={form.forbidden} actions={actions} />
      )}
    </>
  )
}
