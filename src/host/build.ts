/**
 * 纯构建：已收窄的参数 → 表单 → 提示词。
 *
 * 从 `tool.ts` 拆出，让那里只保留"工具定义"（schema、行为、卡片）；这里可以单独被测试
 * 绕过参数校验地调用。
 *
 * 与客户端表单共用 `src/shared/prompt.ts`，因此两个入口的产出必然一致。
 */
import { completeForm } from '../shared/forms.js'
import { applyFormatChoice } from '../shared/format.js'
import { buildSystemPrompt, validateForm } from '../shared/prompt.js'
import { TEMPLATES } from '../shared/templates.js'
import type { OutputFormat, PromptForm, ToolPolicy } from '../shared/types.js'
import { prefer, splitCallableTools } from './args.js'
import type { NarrowedArgs } from './args.js'

/** 构建结果。 */
export interface StructuredPromptValue {
  /** 构建好的提示词。 */
  readonly prompt: string
  /** 用作底座的模板 id；未指定时为空串。 */
  readonly template: string
  /** 补全后仍为空的必填项（正常为空）。 */
  readonly missing: string[]
}

/**
 * 纯构建：参数 → 表单 → 提示词。
 *
 * 空串与空数组算「未给」（见 `prefer`）；`template` 提供默认值、调用参数逐字段覆盖。
 * @param raw - 已收窄的参数。
 * @returns 构建结果。
 */
export function buildFromArgs(raw: NarrowedArgs): StructuredPromptValue {
  const asString = (field: string): string | undefined => {
    const value = raw[field]
    return typeof value === 'string' ? value : undefined
  }
  const asArray = (field: string): string[] | undefined => {
    const value = raw[field]
    return Array.isArray(value) ? value : undefined
  }

  // 模板作为默认值，调用参数逐字段覆盖它。
  const templateId = asString('template')
  const chosen = templateId === undefined
    ? undefined
    : TEMPLATES.find(template => template.id === templateId)
  const base = chosen === undefined ? completeForm({}) : chosen.build()

  const callable = splitCallableTools(asArray('callable_tools') ?? [])
  const format = prefer(asString('output_format') as OutputFormat | undefined, base.outputFormat)
  const providedSpec = asString('output_spec')
  const form: PromptForm = {
    role: prefer(asString('role'), base.role),
    goal: prefer(asString('goal'), base.goal),
    background: prefer(asString('background'), base.background),
    successCriteria: prefer(asString('success_criteria'), base.successCriteria),
    rules: prefer(asArray('rules'), base.rules),
    forbidden: prefer(asArray('forbidden'), base.forbidden),
    toolPolicy: prefer(asString('tool_policy') as ToolPolicy | undefined, base.toolPolicy),
    callableTools: callable.tools.length > 0 ? callable.tools : base.callableTools,
    toolSlots: callable.tools.length > 0 ? callable.slots : base.toolSlots,
    toolGuidance: prefer(asArray('tool_guidance'), base.toolGuidance),
    toolFailure: prefer(asString('tool_failure'), base.toolFailure),
    // 说明为空时按所选格式更新底座（模板可能带着另一套格式的骨架 + 追加内容）——
    // 直接复用客户端那一份规则，避免第二份骨架逻辑各自演化。
    outputSpec: prefer(providedSpec, applyFormatChoice(base.outputSpec, format)),
    outputFormat: format,
    languageTone: prefer(asString('language_tone'), base.languageTone),
    fields: prefer(asArray('fields'), base.fields),
    fallback: prefer(asString('fallback'), base.fallback),
    examples: prefer(asString('examples'), base.examples),
  }

  return {
    prompt: buildSystemPrompt(form),
    template: chosen?.id ?? '',
    missing: validateForm(form),
  }
}
