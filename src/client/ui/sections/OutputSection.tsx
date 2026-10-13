/**
 * 「输出与兜底」分组：格式类型 → 格式说明 → 字段级说明 → 语言语气 → 兜底 → 示例。
 *
 * 选格式类型时会顺带更新格式说明里的骨架部分：说明为空就整段填入；已在某套骨架基础
 * 上追加过内容就只换骨架、保留追加；完全手写的说明不动（用户显式覆盖了格式类型）。
 * 规则本身在 `shared/prompt.ts` 的 `applyFormatChoice`（纯函数，便于测试），并在说明
 * 覆盖了格式类型时给出一句提示，避免"高亮的格式类型其实不生效"。
 */
import type { ReactNode } from 'react'
import type { OutputFormat, PromptForm } from '../../../shared/types.js'
import type { FormActions } from '../actions.js'
import { ChipGroup, Field, TextArea, TextInput } from '../base.js'
import { ListEditor } from '../ListEditor.js'
import { LIST_FIELDS, OUTPUT_FORMAT_OPTIONS } from '../config.js'
import { applyFormatChoice, formatSpecStatus } from '../../../shared/format.js'
import { COLORS } from '../styles.js'

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
  // 仅当"选了格式类型"且"说明与它无关"时才提示；没选格式时说明自成一格，是正常用法。
  const shadowed = form.outputFormat !== ''
    && formatSpecStatus(form.outputSpec, form.outputFormat) === 'detached'
  /** 选择格式类型：同步更新说明里的骨架部分。 */
  const pickFormat = (value: OutputFormat): void => {
    actions.setField('outputFormat', value)
    actions.setField('outputSpec', applyFormatChoice(form.outputSpec, value))
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
      {shadowed ? (
        <p
          role="status"
          style={{ margin: 0, fontSize: 12, color: COLORS.caption }}
        >
          格式类型已不生效：下面是手写的输出格式说明，它才是最终契约。
        </p>
      ) : null}
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
