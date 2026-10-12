/**
 * 工具参数的处理：收窄、默认值回退、以及工具名/用途的配对拆分。
 *
 * 从 `tool.ts` 拆出，让那个文件只留「定义 + 构建」。
 *
 * 这里承担了 registry 之外的类型检查：本插件刻意不 import 宿主包（理由见
 * `parameters.ts`），因此不能借 `defineTool` 做参数校验，逐字段检查由 `narrowArgs`
 * 代劳。不合规就**报错**而不是静默丢弃 —— 失败说明会回到模型手里，它能据此改正。
 */
import { OUTPUT_FORMAT_SKELETONS } from '../shared/prompt.js'
import type { OutputFormat } from '../shared/types.js'

/** 需要按「字符串数组」读取的字段名。 */
export const ARRAY_FIELDS = ['rules', 'forbidden', 'callable_tools', 'tool_guidance', 'fields'] as const

/** 需要按「字符串」读取的非必填字段名。 */
export const STRING_FIELDS = [
  'template', 'background', 'success_criteria', 'tool_policy', 'tool_failure',
  'output_format', 'output_spec', 'language_tone', 'fallback', 'examples',
] as const

/** 模型传入的参数（键全部可选；`role` / `goal` 由校验强制）。 */
export interface ToolArgs extends Record<string, unknown> {
  role?: unknown
  goal?: unknown
}

/** 收窄后的参数：两个必填项保证存在，其余按需。 */
export type NarrowedArgs = { role: string; goal: string } & Record<string, string | string[] | undefined>

/**
 * 把模型传入的参数收窄成可用形状。
 * @param raw - 模型传入的参数。
 * @returns 收窄后的参数。
 * @throws {Error} 缺少必填项或字段类型不符时。
 */
export function narrowArgs(raw: unknown): NarrowedArgs {
  if (typeof raw !== 'object' || raw === null) throw new Error('arguments must be an object')
  const args = raw as ToolArgs
  const problems: string[] = []

  for (const field of ['role', 'goal'] as const) {
    const value = args[field]
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${field} is required and must be a non-empty string`)
    }
  }
  for (const field of STRING_FIELDS) {
    const value = args[field]
    if (value !== undefined && typeof value !== 'string') problems.push(`${field} must be a string`)
  }
  for (const field of ARRAY_FIELDS) {
    const value = args[field]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      problems.push(`${field} must be an array of strings`)
    }
  }
  if (problems.length > 0) throw new Error(`invalid arguments: ${problems.join('; ')}`)

  const narrowed: NarrowedArgs = {
    role: (args.role as string).trim(),
    goal: (args.goal as string).trim(),
  }
  for (const field of STRING_FIELDS) {
    const value = args[field]
    if (typeof value === 'string') narrowed[field] = value
  }
  for (const field of ARRAY_FIELDS) {
    const value = args[field]
    if (Array.isArray(value)) narrowed[field] = value as string[]
  }
  return narrowed
}

/**
 * 取「调用参数优先，未给则用模板默认值」的值。
 *
 * 空串与空数组都算「未给」：模板填了 3 条硬性规则时，模型传 `rules: []` 的意图几乎
 * 总是"没额外要求"，而不是"把模板的规则删掉"。
 * @param provided - 模型传入的值。
 * @param fallback - 模板/空白表单的默认值。
 * @returns 生效的值。
 */
export function prefer<T>(provided: T | undefined, fallback: T): T {
  if (provided === undefined) return fallback
  if (typeof provided === 'string' && provided.trim() === '') return fallback
  if (Array.isArray(provided) && provided.length === 0) return fallback
  return provided
}

/**
 * 把「工具名」或「工具名：用途」形式的条目拆成两个按索引配对的数组。
 *
 * 表单侧是工具名与用途两个数组配对编辑；工具参数为了简洁只收一个字符串数组，
 * 因此在这里按全角/半角冒号拆一次。
 * @param entries - 模型传入的条目。
 * @returns 工具名数组与用途数组（长度对齐）。
 */
export function splitCallableTools(entries: readonly string[]): { tools: string[]; slots: string[] } {
  const tools: string[] = []
  const slots: string[] = []
  for (const entry of entries) {
    const matched = /^([^：:]+)[：:](.*)$/.exec(entry)
    if (matched === null) {
      tools.push(entry.trim())
      slots.push('')
    } else {
      tools.push((matched[1] ?? '').trim())
      slots.push((matched[2] ?? '').trim())
    }
  }
  return { tools, slots }
}

/**
 * 解析输出格式说明，语义与客户端 `OutputSection.pickFormat` 一致：选了格式就补上该
 * 格式骨架，但**只在本字段为空、或正文仍恰好是另一套骨架**时覆盖 —— 手写过的内容
 * 不会被冲掉。两个入口行为一致，才不会出现"表单里选 json 有骨架、工具里选 json 没
 * 骨架"的偏差。
 * @param providedSpec - 模型传入的格式说明。
 * @param format - 生效的输出格式。
 * @param baseSpec - 模板/空白表单的格式说明。
 * @returns 生效的格式说明。
 */
export function resolveOutputSpec(
  providedSpec: string | undefined,
  format: OutputFormat,
  baseSpec: string,
): string {
  const provided = providedSpec !== undefined && providedSpec.trim() !== ''
  const current = provided ? providedSpec : baseSpec
  if (provided || format === '') return current
  const known: string[] = Object.values(OUTPUT_FORMAT_SKELETONS)
  if (current.trim() !== '' && !known.includes(current)) return current
  return OUTPUT_FORMAT_SKELETONS[format]
}
