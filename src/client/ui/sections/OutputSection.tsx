/**
 * 「输出与兜底」分组：格式类型 → 格式说明 → 字段级说明 → 语言语气 → 兜底 → 示例。
 *
 * 选格式类型时会顺带填入该格式的骨架，但只在正文为空、或正文仍是另一套骨架时
 * 覆盖 —— 用户手写过的内容不会被冲掉。
 */
import type { ReactNode } from 'react'
import type { OutputFormat, PromptForm } from '../../types.js'
import type { FormActions } from '../actions.js'
import { ChipGroup, Field, TextArea, TextInput } from '../base.js'
import { ListEditor } from '../ListEditor.js'
import { LIST_FIELDS, OUTPUT_FORMAT_OPTIONS } from '../config.js'
import { OUTPUT_FORMAT_SKELETONS } from '../../prompt.js'

/** 输出与兜底分组的 props。 */
export interface OutputSectionProps {
  /** 表单。 */
  form: PromptForm
  /** store 动作。 */
  actions: FormActions
}

/**
 * 输出与兜底分组。
 * @param props - 表单与动作。
 * @returns 字段组。
 */
export function OutputSection({ form, actions }: OutputSectionProps): ReactNode {
  const fields = LIST_FIELDS['fields']
  /** 选择格式类型：必要时把骨架写进说明字段。 */
  const pickFormat = (value: OutputFormat): void => {
    actions.setField('outputFormat', value)
    if (value === '') return
    const skeleton = OUTPUT_FORMAT_SKELETONS[value]
    const known: string[] = Object.values(OUTPUT_FORMAT_SKELETONS)
    const current = form.outputSpec.trim()
    if (current === '' || known.includes(form.outputSpec)) {
      actions.setField('outputSpec', skeleton)
    }
  }
  return (
    <>
      <Field label="输出格式类型">
        <ChipGroup
          options={OUTPUT_FORMAT_OPTIONS}
          value={form.outputFormat}
          onPick={value => pickFormat(value as OutputFormat)}
        />
      </Field>
      <Field label="输出格式说明">
        <TextArea
          value={form.outputSpec}
          ariaLabel="输出格式说明"
          placeholder="以 JSON 输出，字段如下：…"
          onChange={value => actions.setField('outputSpec', value)}
        />
      </Field>
      {fields === undefined ? null : (
        <ListEditor field={fields} items={form.fields} actions={actions} />
      )}
      <Field label="语言与语气">
        <TextInput
          value={form.languageTone}
          ariaLabel="语言与语气"
          placeholder="例如：中文，简洁直接，面向工程师"
          onChange={value => actions.setField('languageTone', value)}
        />
      </Field>
      <Field label="数据不足时的行为">
        <TextArea
          value={form.fallback}
          ariaLabel="数据不足时的行为"
          placeholder={'例如：若关键指标或阈值任一缺失，severity 返回 "info"，并在 data_gaps 中列出缺失项。禁止编造数值。'}
          onChange={value => actions.setField('fallback', value)}
        />
      </Field>
      <Field label="少样本示例">
        <TextArea
          value={form.examples}
          ariaLabel="少样本示例"
          placeholder="给 1-2 个输入/输出对照示例"
          onChange={value => actions.setField('examples', value)}
        />
      </Field>
    </>
  )
}
