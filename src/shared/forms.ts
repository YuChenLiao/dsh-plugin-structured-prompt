/**
 * 表单的构造与序列化工具。
 *
 * 独立成模块是为了让 `store.ts`（状态）与 `templates.ts`（模板）共用同一份空白
 * 字段定义，而两者之间不必互相引用。
 *
 * 序列化一侧（`serializeForm` / `parseFormDocument`）承担两件事：给导出文档打上
 * schema 版本号，以及把导入的任意 JSON **过滤 + 校验**成已知字段 —— 直接铺进表单
 * 会让未知键混进 `PromptForm`。
 */
import { OUTPUT_FORMAT_SKELETONS } from './prompt.js'
import type { PromptForm, ToolPolicy } from './types.js'

/** 导出文档的当前 schema 版本。字段增删或语义变化时递增。 */
export const FORM_DOCUMENT_VERSION = 1

/** 导出/导入的 JSON 文档形状。 */
export interface FormDocument {
  /** schema 版本。 */
  version: number
  /** 表单字段。 */
  form: PromptForm
}

/** `toolPolicy` 的合法取值。 */
const TOOL_POLICY_VALUES = ['', 'auto', 'manual'] as const satisfies readonly ToolPolicy[]

/** `outputFormat` 的合法取值：骨架表的键就是权威来源，避免两份清单漂移。 */
const OUTPUT_FORMAT_VALUES: readonly string[] = ['', ...Object.keys(OUTPUT_FORMAT_SKELETONS)]

/**
 * 每个字段的运行时形状，用于导入校验。
 *
 * 用 `satisfies Record<keyof PromptForm, string>` 约束：`PromptForm` 增删字段时这里
 * 会直接编译失败，不会悄悄漏掉一个字段的校验。
 */
const FIELD_SHAPES = {
  role: 'string',
  goal: 'string',
  background: 'string',
  successCriteria: 'string',
  rules: 'string[]',
  forbidden: 'string[]',
  toolPolicy: 'tool-policy',
  callableTools: 'string[]',
  toolSlots: 'string[]',
  toolGuidance: 'string[]',
  toolFailure: 'string',
  outputSpec: 'string',
  outputFormat: 'output-format',
  languageTone: 'string',
  fields: 'string[]',
  fallback: 'string',
  examples: 'string',
} as const satisfies Record<keyof PromptForm, string>

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

/**
 * 把表单序列化成带版本号的导出文档。
 * @param form - 表单字段。
 * @returns 可写进文件的文档对象。
 */
export function serializeForm(form: PromptForm): FormDocument {
  return { version: FORM_DOCUMENT_VERSION, form }
}

/** 解析结果：可用的表单片段 + 被忽略内容的说明。 */
export interface ParsedForm {
  /** 通过校验的字段。 */
  patch: Partial<PromptForm>
  /** 被忽略的内容（未知键、类型不符、越界枚举、更新的文档版本）。空数组表示完全干净。 */
  warnings: string[]
}

/**
 * 按声明的形状校验一个字段值。
 * @param value - 待校验的值。
 * @param shape - 期望形状。
 * @returns 是否合法。
 */
function matchesShape(value: unknown, shape: string): boolean {
  if (shape === 'string') return typeof value === 'string'
  if (shape === 'string[]') {
    return Array.isArray(value) && value.every(item => typeof item === 'string')
  }
  if (shape === 'tool-policy') return TOOL_POLICY_VALUES.includes(value as ToolPolicy)
  if (shape === 'output-format') return OUTPUT_FORMAT_VALUES.includes(value as string)
  return false
}

/**
 * 解析导入的表单文档。
 *
 * 接受两种输入：
 *  - 本版本导出的文档 `{ version, form }`；
 *  - 早期版本直接导出的**裸表单**（没有 `version`，按最初版本解析）。
 *
 * 只保留已知字段并逐字段校验形状：未知键、类型不符、越界枚举都会被丢弃并记进
 * `warnings`，而不是混进表单。用户手改 JSON 是常见操作，静默接受坏值会让问题推迟
 * 到构建提示词时才暴露。
 * @param text - 文件内容。
 * @returns 表单片段与被忽略内容的说明。
 * @throws {Error} 内容不是合法 JSON、或顶层不是对象时。
 */
export function parseFormDocument(text: string): ParsedForm {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('不是合法的 JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('顶层必须是对象')
  }

  const warnings: string[] = []
  const record = raw as Record<string, unknown>
  let source: Record<string, unknown> = record

  if ('version' in record || 'form' in record) {
    const version = record['version']
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new Error('version 必须是正整数')
    }
    if (version > FORM_DOCUMENT_VERSION) {
      warnings.push(`文档版本 ${version} 比本插件支持的 ${FORM_DOCUMENT_VERSION} 新，未识别的字段会被忽略`)
    }
    const inner = record['form']
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) {
      throw new Error('form 必须是对象')
    }
    source = inner as Record<string, unknown>
  } else {
    warnings.push('这是没有版本号的旧导出文件，已按最初版本解析')
  }

  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    const shape = (FIELD_SHAPES as Record<string, string | undefined>)[key]
    if (shape === undefined) {
      warnings.push(`忽略未知字段 ${key}`)
      continue
    }
    if (!matchesShape(value, shape)) {
      warnings.push(`忽略字段 ${key}：取值不符合 ${shape}`)
      continue
    }
    patch[key] = value
  }

  return { patch: patch as Partial<PromptForm>, warnings }
}
