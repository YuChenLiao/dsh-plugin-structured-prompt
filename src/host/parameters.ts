/**
 * 工具的参数与输出 schema（纯数据，无逻辑）。
 *
 * 与 `tool.ts` 分开是为了让那个文件只承载「参数 → 表单 → 提示词」的映射逻辑。
 * 这里不标注类型：`defineTool` 需要从字面量推导出参数的精确类型（推断出的 `args`
 * 会直接成为 `execute` 的入参类型），写成变量会让推导退化成宽泛类型。
 */
import { OUTPUT_FORMAT_SKELETONS } from '../shared/prompt.js'
import { TEMPLATES } from '../shared/templates.js'

/**
 * 可选的输出格式：取自构建器的骨架表，避免两份清单各自漂移。
 * @see OUTPUT_FORMAT_SKELETONS
 */
export const OUTPUT_FORMATS: string[] = Object.keys(OUTPUT_FORMAT_SKELETONS)

/** 可选的内置模板 id。 */
export const TEMPLATE_IDS: string[] = TEMPLATES.map(template => template.id)

/** 工具调用策略的取值。 */
export const TOOL_POLICIES = ['auto', 'manual'] as const

/** 模型面向的工具说明。 */
export const TOOL_DESCRIPTION = [
  'Build a precise, structured prompt and return it verbatim.',
  'Use it to turn a vague delegation into an explicit one: fill `role` and `goal` (plus',
  'whichever optional fields matter) and pass the returned text as the `prompt` argument',
  'of the subagent tool. Those two are required, matching the form; every other field is',
  'optional — add `rules`, `forbidden`, `output_format`, `fallback` and so on when the',
  'child needs tighter constraints. `template` starts from a built-in template — its',
  'fields act as defaults and anything you pass overrides them.',
].join(' ')

/**
 * 参数表。
 *
 * 分节顺序与客户端表单一致（身份/目标 → 规则 → 工具 → 输出/兜底），便于两边对照。
 */
export const TOOL_PARAMETERS = {
  role: {
    type: 'string',
    required: true,
    description: 'The identity the target agent should adopt (e.g. "a strict senior engineer"). Required, like the form.',
  },
  goal: {
    type: 'string',
    required: true,
    description: 'The task the target agent must accomplish. One or two imperative sentences.',
  },
  template: {
    type: 'string',
    enum: TEMPLATE_IDS,
    description: 'Start from a built-in template; its fields become defaults for anything you omit.',
  },
  background: {
    type: 'string',
    description: 'Context the target agent needs but cannot infer (paths, stack, prior decisions).',
  },
  success_criteria: {
    type: 'string',
    description: 'How the result will be judged — the evidence that makes the task done.',
  },
  rules: {
    type: 'array',
    items: { type: 'string' },
    description: 'Hard constraints, emitted as a numbered list. Order is preserved.',
  },
  forbidden: {
    type: 'array',
    items: { type: 'string' },
    description: 'Explicitly disallowed actions, emitted as a sub-block under the hard rules.',
  },
  tool_policy: {
    type: 'string',
    enum: TOOL_POLICIES,
    description: 'auto: let the target agent choose tools. manual: it may use only `callable_tools`.',
  },
  callable_tools: {
    type: 'array',
    items: { type: 'string' },
    description: 'With tool_policy=manual, the allowed tools. Each entry is `tool_name` or `tool_name: purpose`.',
  },
  tool_guidance: {
    type: 'array',
    items: { type: 'string' },
    description: 'Per-line rules about when and how to use tools.',
  },
  tool_failure: {
    type: 'string',
    description: 'What to do when a tool call fails (retry, fall back, report).',
  },
  output_format: {
    type: 'string',
    enum: OUTPUT_FORMATS,
    description: 'Output shape; also seeds `output_spec` with a skeleton when you omit it.',
  },
  output_spec: {
    type: 'string',
    description: 'Exact output contract — sections, keys, ordering. Overrides the format skeleton.',
  },
  language_tone: {
    type: 'string',
    description: 'Language and tone for the final answer.',
  },
  fields: {
    type: 'array',
    items: { type: 'string' },
    description: 'Per-field requirements for structured output (one line each).',
  },
  fallback: {
    type: 'string',
    description: 'What to do when the task cannot be completed as specified (e.g. insufficient data).',
  },
  examples: {
    type: 'string',
    description: 'A short input/output example when the expected shape is easier to show than to describe.',
  },
} as const

/** canonical 输出值的 schema。 */
export const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: { type: 'string', required: true, description: 'The built prompt, ready to use as-is.' },
    template: { type: 'string', required: true, description: 'Template id used as the base; empty when none.' },
    missing: {
      type: 'array',
      required: true,
      items: { type: 'string' },
      description: 'Required fields still empty after completion (normally empty).',
    },
  },
} as const
