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
import { findTemplate } from '../shared/templates.js'
import type { OutputFormat, PromptForm, ToolPolicy } from '../shared/types.js'
import { isProvidedList, prefer, splitCallableTools } from './args.js'
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
 * 空串（含纯空白）、空数组与全空白条目都算「未给」（见 `prefer` 与 `isProvidedList`）；
 * `template` 提供默认值、调用参数逐字段覆盖。
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

  // 模板作为默认值，调用参数逐字段覆盖它。id → 模板的解析只有一处（`findTemplate`），
  // 表单侧与 host 侧共用，避免两边各自查表后漂移。
  const chosen = findTemplate(asString('template') ?? '')
  const base = chosen === undefined ? completeForm({}) : chosen.build()

  const rawTools = asArray('callable_tools')
  // 工具清单整组选定（见 `resolveCallableTools`）：底座为空时"一退一留"在产物上不可
  // 观测，所以这条不变量由那个纯函数与它的断言一起守，而不是散在这里的两条三元里。
  const picked = resolveCallableTools(rawTools, splitCallableTools(rawTools ?? []), base)
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
    callableTools: picked.callableTools,
    toolSlots: picked.toolSlots,
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

/**
 * 选出最终生效的工具名与用途。
 *
 * 两个字段**整组同进同退**：要么都取调用参数，要么都回退底座。判定按**原始条目**做，
 * 而不是按拆分后的工具名 —— `[': 用途']` 算"给了"（用途非空），那一行随后由下游按空
 * 工具名整行忽略；若改成拿拆分后的两个数组各自判定，工具名会回退底座而用途不回退，
 * 用途就配到了别的工具上。
 *
 * 抽成纯函数是为了让这条不变量能被直接断言：内置模板都不带清单，底座为空时"一退一留"
 * 在产物上不可观测，只能测这个函数本身。
 * @param rawTools - `callable_tools` 的原始取值（未拆分）；`undefined` 表示未给。
 * @param callable - 拆分后的工具名与用途。
 * @param base - 底座表单（模板或空白）。
 * @returns 生效的工具名与用途；两者来源与长度都一致。
 */
export function resolveCallableTools(
  rawTools: readonly string[] | undefined,
  callable: { readonly tools: readonly string[]; readonly slots: readonly string[] },
  base: PromptForm,
): { callableTools: string[]; toolSlots: string[] } {
  return isProvidedList(rawTools)
    ? { callableTools: [...callable.tools], toolSlots: [...callable.slots] }
    : { callableTools: [...base.callableTools], toolSlots: [...base.toolSlots] }
}
