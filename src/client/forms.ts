/**
 * 表单的构造工具：空白表单与「以片段补全」。
 *
 * 独立成模块是为了让 `store.ts`（状态）与 `templates.ts`（模板）共用同一份空白
 * 字段定义，而两者之间不必互相引用。
 */
import type { PromptForm } from './types.js'

/**
 * 空白表单：所有数组为空、所有文本为空，保证「未填写」与「空串」一致。
 * @returns 全新的空白表单。
 */
export function createEmptyForm(): PromptForm {
  return {
    role: '',
    goal: '',
    background: '',
    successCriteria: '',
    rules: [],
    forbidden: [],
    toolPolicy: '',
    callableTools: [],
    toolSlots: [],
    toolGuidance: [],
    toolFailure: '',
    outputSpec: '',
    outputFormat: '',
    languageTone: '',
    fields: [],
    fallback: '',
    examples: '',
  }
}

/**
 * 用片段补全成完整表单。
 *
 * 模板与 JSON 导入都只提供部分字段，缺省项由空白表单补齐 —— 这样新增字段时无需
 * 逐个模板补齐，也不会因为 `undefined` 漏进渲染。
 * @param patch - 部分字段。
 * @returns 完整表单。
 */
export function completeForm(patch: Partial<PromptForm>): PromptForm {
  return { ...createEmptyForm(), ...patch }
}
