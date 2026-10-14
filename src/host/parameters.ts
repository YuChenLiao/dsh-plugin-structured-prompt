/**
 * 工具的参数与输出 schema（纯数据，无逻辑）。
 *
 * 这里写的是**标准 JSON Schema**，而不是 DSH `defineTool` 的作者向 spec —— 因为本插件
 * 刻意**不 import 任何宿主包**：
 *
 * 宿主包（`@deepseek-ai/dsh-tools`）只能从 profile 的 node_modules 解析，而 `link:`
 * 安装下插件经 junction 加载，ESM 会 realpath 到源码目录，向上找不到任何 node_modules
 * → 模块加载失败 → 插件 fiber 停在未激活状态（表现为工具不注册，且不报错）。
 * client 半边本来就用本地类型声明避开同类问题，host 半边照做。
 *
 * 与 `tool.ts` 分开是为了让那个文件只承载「参数 → 表单 → 提示词」的映射逻辑。
 */
import { OUTPUT_FORMAT_SKELETONS } from '../shared/format.js'
import { TEMPLATES } from '../shared/templates.js'

/**
 * 可选的输出格式：取自构建器的骨架表，避免两份清单各自漂移。
 * @see OUTPUT_FORMAT_SKELETONS
 */
export const OUTPUT_FORMATS: string[] = Object.keys(OUTPUT_FORMAT_SKELETONS)

/** 可选的内置模板 id。 */
export const TEMPLATE_IDS: string[] = TEMPLATES.map(template => template.id)

/** 模型面向的工具说明。 */
export const TOOL_DESCRIPTION = [
  'Build a precise, structured prompt and return it verbatim.',
  'Use it to turn a vague delegation into an explicit one: fill `role` and `goal` (plus',
  'whichever optional fields matter) and pass the returned text as the `prompt` argument',
  'of the subagent tool. Those two are required, matching the form; every other field is',
  'optional — add `rules`, `forbidden`, `output_format`, `fallback` and so on when the',
  'child needs tighter constraints. `template` starts from a built-in template — its',
  'fields act as defaults and anything you pass overrides them.',
  // 说清"什么时候不该用"：简单任务直接调 subagent 更省，否则模型会对每个委托都先构建一遍。
  'Skip it for simple delegations — calling the subagent tool directly with a plain task is',
  'cheaper. This tool earns its cost when the child needs several explicit constraints you',
  'would otherwise have to spell out anyway.',
].join(' ')

/**
 * 参数表（标准 JSON Schema）。
 *
 * 分节顺序与客户端表单一致（身份/目标 → 规则 → 工具 → 输出/兜底），便于两边对照。
 * `additionalProperties: false` 让越界字段在 schema 边界被拒绝，而不是被静默忽略。
 */
export const TOOL_PARAMETERS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: {
      type: 'string',
      description: 'The identity the target agent should adopt (e.g. "a strict senior engineer"). Required, like the form.',
    },
    goal: {
      type: 'string',
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
      enum: ['auto', 'manual'],
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
    delegate: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: {
          type: 'string',
          description: 'Short label for the delegation, shown in the child list.',
        },
        provider: {
          type: 'string',
          description: 'Subagent provider name. Normally omit it: the default (a one-shot run) is used. Pass it only to deliberately delegate through another registered provider — e.g. one that inherits this conversation instead of working independently.',
        },
      },
      description: 'Run the built prompt as a foreground subagent instead of returning it. The prompt never enters your own context, which keeps long prompts cheap. Omit to just get the prompt back.',
    },
  },
  required: ['role', 'goal'],
}

/** canonical 输出值的 schema。 */
export const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: { type: 'string', description: 'The built prompt, ready to use as-is.' },
    template: { type: 'string', description: 'Template id used as the base; empty when none.' },
    missing: {
      type: 'array',
      items: { type: 'string' },
      description: 'Required fields still empty after completion (normally empty).',
    },
    delegated: {
      type: 'string',
      description: 'The subagent\'s output when `delegate` was set; empty otherwise.',
    },
    delegation: {
      type: 'string',
      description: 'Non-empty when the prompt was actually delegated, e.g. "spawn/child-1 (completed)". Distinguishes a silent subagent (completed but produced no text) from no delegation at all.',
    },
  },
  required: ['prompt', 'template', 'missing', 'delegated', 'delegation'],
}
