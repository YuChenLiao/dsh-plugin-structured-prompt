/**
 * 「工具策略」分组：策略选择 + 点名工具（手动时）+ 逐条策略 + 失败处理。
 *
 * 自动与手动是同一字段 `toolPolicy` 的两种取值；手动时才展开工具名编辑，因为
 * 只有那时工具清单会进入提示词。
 */
import type { ReactNode } from 'react'
import type { PromptForm, ToolPolicy } from '../../../shared/types.js'
import type { FormActions } from '../actions.js'
import { ChipGroup, Field, TextArea } from '../base.js'
import { ListEditor } from '../ListEditor.js'
import { ToolPairEditor } from '../ToolPairEditor.js'
import { LIST_FIELDS, TOOL_POLICY_OPTIONS } from '../config.js'

/** 工具策略分组的 props。 */
export interface ToolsSectionProps {
  /** 表单。 */
  form: PromptForm
  /** store 动作。 */
  actions: FormActions
}

/**
 * 工具策略分组。
 * @param props - 表单与动作。
 * @returns 字段组。
 */
export function ToolsSection({ form, actions }: ToolsSectionProps): ReactNode {
  const guidance = LIST_FIELDS['toolGuidance']
  return (
    <>
      <Field label="调用工具策略">
        <ChipGroup
          options={TOOL_POLICY_OPTIONS}
          value={form.toolPolicy}
          onPick={value => actions.setField('toolPolicy', value as ToolPolicy)}
        />
      </Field>
      {form.toolPolicy === 'manual'
        ? <ToolPairEditor form={form} actions={actions} />
        : null}
      {guidance === undefined ? null : (
        <ListEditor field={guidance} items={form.toolGuidance} actions={actions} />
      )}
      <Field label="工具失败时的处理">
        <TextArea
          value={form.toolFailure}
          ariaLabel="工具失败时的处理"
          placeholder="例如：任何一次工具调用失败，最多重试一次；仍失败则直接报告失败，不要用估计值代替。"
          onChange={value => actions.setField('toolFailure', value)}
        />
      </Field>
    </>
  )
}
