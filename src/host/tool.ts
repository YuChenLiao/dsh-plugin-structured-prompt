/**
 * 模型可调用的结构化提示词构建工具。
 *
 * 与客户端表单**共用** `src/shared/prompt.ts` 的构建逻辑，因此两个入口产出的提示词
 * 完全一致（段落顺序、省略规则、编号格式都是同一份实现）。参数与输出 schema 见
 * `parameters.ts`，参数收窄与映射工具见 `args.ts`。
 *
 * 工具只**产出**提示词，不启动子代理：模型拿到文本后自行决定用途 —— 作为 `subagent`
 * 的 `prompt` 参数、写进文件、或用在自己身上。这样本插件对子代理机制零耦合，也不
 * 需要关心 provider、前后台、深度限制等策略。
 *
 * **不 import 任何宿主包**：工具定义按 DSH 的 `ToolDefinition` 契约手工构造（理由见
 * `parameters.ts`）。这是本插件在 `link:` 安装下能正常激活的前提 —— 宿主包只能从
 * profile 的 node_modules 解析，而 link 经 junction 加载后 ESM 会 realpath 到源码目录，
 * 那里没有任何 node_modules。
 */
import { completeForm } from '../shared/forms.js'
import { buildSystemPrompt, validateForm } from '../shared/prompt.js'
import { TEMPLATES } from '../shared/templates.js'
import type { OutputFormat, PromptForm, ToolPolicy } from '../shared/types.js'
import { narrowArgs, prefer, resolveOutputSpec, splitCallableTools } from './args.js'
import type { NarrowedArgs } from './args.js'
import { TOOL_DESCRIPTION, TOOL_OUTPUT_SCHEMA, TOOL_PARAMETERS_SCHEMA } from './parameters.js'

/** 模型可见的工具名。 */
export const STRUCTURED_PROMPT_TOOL = 'build_structured_prompt'

/** 内容块（本工具只用到文本块）。 */
export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** 工具的 canonical 输出值。 */
export interface StructuredPromptValue {
  /** 构建好的提示词。 */
  readonly prompt: string
  /** 用作底座的模板 id；未指定时为空串。 */
  readonly template: string
  /** 补全后仍为空的必填项（正常为空）。 */
  readonly missing: string[]
}

/**
 * 工具定义（本插件构造的最小形态）。
 *
 * 只声明本插件实际提供的成员，不引入 DSH 的包 —— registry 只消费这些字段。
 */
export interface ToolDefinitionLike {
  /** 工具名。 */
  readonly name: string
  /** 模型面向的说明。 */
  readonly description: string
  /** 参数 JSON Schema。 */
  readonly parameters: Record<string, unknown>
  /** 输出契约。 */
  readonly output: {
    /** canonical 值的 JSON Schema。 */
    readonly schema: Record<string, unknown>
    /**
     * 把 canonical 值投影成模型看到的内容。
     * @param args - 调用参数。
     * @param value - canonical 值。
     * @returns 内容块。
     */
    render(args: unknown, value: StructuredPromptValue): TextBlock[]
  }
  /**
   * 执行一次调用。
   * @param args - 模型传入的参数。
   * @param exec - 执行上下文（本工具不使用）。
   * @returns canonical 值。
   */
  execute(args: unknown, exec: unknown): Promise<StructuredPromptValue>
}

/** 宿主侧上下文：本插件只消费工具注册面。 */
export interface HostPluginContext {
  tools: {
    /**
     * 注册一个工具。
     * @param definition - 工具定义。
     * @returns 服务的返回值（取消注册函数）。
     */
    register(definition: ToolDefinitionLike): unknown
  }
}

/**
 * 纯构建：参数 → 表单 → 提示词。
 *
 * 与 `execute` 分开，让测试可以绕过参数校验直接验证映射规则。
 * @param raw - 已收窄的参数。
 * @returns canonical 值。
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
    outputSpec: resolveOutputSpec(asString('output_spec'), format, base.outputSpec),
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
 * 构造工具定义。
 *
 * 单独导出（而不是在模块顶层直接构造）是为了让测试能拿到定义直接调用 `execute` /
 * `render`，无需启动一个 Cordis 上下文。
 * @returns registry-ready 的工具定义。
 */
export function createStructuredPromptTool(): ToolDefinitionLike {
  return {
    name: STRUCTURED_PROMPT_TOOL,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS_SCHEMA,
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: value.missing.length === 0
          ? value.prompt
          : `${value.prompt}\n\n---\n(Required field(s) still empty: ${value.missing.join(', ')}.)`,
      }],
    },
    execute(args) {
      return Promise.resolve(buildFromArgs(narrowArgs(args)))
    },
  }
}

/**
 * 注册结构化提示词工具。
 * @param ctx - host 侧插件上下文。
 * @returns 服务的返回值（取消注册函数）。
 */
export function registerStructuredPromptTool(ctx: HostPluginContext): unknown {
  return ctx.tools.register(createStructuredPromptTool())
}
