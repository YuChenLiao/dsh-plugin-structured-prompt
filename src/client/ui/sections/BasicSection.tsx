/**
 * 「基础信息」分组：身份与目标（必填）+ 背景与上下文 + 成功标准。
 *
 * 常开不可折叠 —— 它是必填项所在的分组，折叠只会让用户找不到入口。
 */
import type { ReactNode } from 'react'
import type { PromptForm } from '../../types.js'
import type { FormActions } from '../actions.js'
import { Field, TextArea } from '../base.js'

/** 基础信息分组的 props。 */
export interface BasicSectionProps {
  /** 表单。 */
  form: PromptForm
  /** store 动作。 */
  actions: FormActions
}

/**
 * 基础信息分组。
 * @param props - 表单与动作。
 * @returns 字段组。
 */
export function BasicSection({ form, actions }: BasicSectionProps): ReactNode {
  return (
    <>
      <Field label="身份" required>
        <TextArea
          value={form.role}
          ariaLabel="身份"
          placeholder="例如：你是一名负责线上稳定性的 SRE 助手，服务于一个日订单量百万级的电商系统。"
          onChange={value => actions.setField('role', value)}
        />
      </Field>
      <Field label="目标" required>
        <TextArea
          value={form.goal}
          ariaLabel="目标"
          placeholder="例如：根据监控数据判断告警是否需要人工立即介入，并给出首要排查方向。"
          onChange={value => actions.setField('goal', value)}
        />
      </Field>
      <Field label="背景与上下文">
        <TextArea
          value={form.background}
          ariaLabel="背景与上下文"
          placeholder="业务场景、系统规模、技术栈等（会并入「身份」段）"
          onChange={value => actions.setField('background', value)}
        />
      </Field>
      <Field label="成功标准">
        <TextArea
          value={form.successCriteria}
          ariaLabel="成功标准"
          placeholder="可验收的完成判据（会并入「目标」段）"
          onChange={value => actions.setField('successCriteria', value)}
        />
      </Field>
    </>
  )
}
