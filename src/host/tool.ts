/**
 * 模型可调用的结构化提示词构建工具。
 *
 * 与客户端表单**共用** `src/shared/prompt.ts` 的构建逻辑，因此两个入口产出的提示词
 * 完全一致（段落顺序、省略规则、编号格式都是同一份实现）。参数与输出 schema 见
 * `parameters.ts`。
 *
 * 工具只**产出**提示词，不启动子代理：模型拿到文本后自行决定用途 —— 作为 `subagent`
 * 的 `prompt` 参数、写进文件、或用在自己身上。这样本插件对子代理机制零耦合，也不
 * 需要关心 provider、前后台、深度限制等策略。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { completeForm } from '../shared/forms.js'
import { OUTPUT_FORMAT_SKELETONS, buildSystemPrompt, validateForm } from '../shared/prompt.js'
import { TEMPLATES } from '../shared/templates.js'
import type { OutputFormat, PromptForm, ToolPolicy } from '../shared/types.js'
import { TOOL_DESCRIPTION, TOOL_OUTPUT_SCHEMA, TOOL_PARAMETERS } from './parameters.js'

/** 模型可见的工具名。 */
export const STRUCTURED_PROMPT_TOOL = 'build_structured_prompt'

/** 宿主侧上下文：本插件只消费工具注册面。 */
export interface HostPluginContext {
  tools: {
    /**
     * 注册一个工具。
     * @param definition - 工具定义。
     * @returns 取消注册的函数。
     */
    register(definition: ToolDefinition): () => void
  }
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
function prefer<T>(provided: T | undefined, fallback: T): T {
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
function splitCallableTools(entries: readonly string[]): { tools: string[]; slots: string[] } {
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
function resolveOutputSpec(providedSpec: string | undefined, format: OutputFormat, baseSpec: string): string {
  const provided = providedSpec !== undefined && providedSpec.trim() !== ''
  const current = provided ? providedSpec : baseSpec
  if (provided || format === '') return current
  const known: string[] = Object.values(OUTPUT_FORMAT_SKELETONS)
  if (current.trim() !== '' && !known.includes(current)) return current
  return OUTPUT_FORMAT_SKELETONS[format]
}

/**
 * 构造工具定义。
 *
 * 单独导出（而不是在模块顶层直接构造）是为了让测试能拿到定义直接调用 `execute` /
 * `render`，无需启动一个 Cordis 上下文。
 * @returns registry-ready 的工具定义。
 */
export function createStructuredPromptTool(): ToolDefinition {
  return defineTool({
    name: STRUCTURED_PROMPT_TOOL,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: value.missing.length === 0
          ? value.prompt
          : `${value.prompt}\n\n---\n(Required field(s) still empty: ${value.missing.join(', ')}.)`,
      }],
    },
    // 不标注返回类型：让 defineTool 按 output.schema 推导出精确的 canonical 值。
    execute(args) {
      // 模板作为默认值，调用参数逐字段覆盖它。
      const chosen = args.template === undefined
        ? undefined
        : TEMPLATES.find(template => template.id === args.template)
      const base = chosen === undefined ? completeForm({}) : chosen.build()

      const callable = splitCallableTools(args.callable_tools ?? [])
      const format = prefer(args.output_format, base.outputFormat) as OutputFormat
      const form: PromptForm = {
        role: prefer(args.role, base.role),
        goal: prefer(args.goal, base.goal),
        background: prefer(args.background, base.background),
        successCriteria: prefer(args.success_criteria, base.successCriteria),
        rules: prefer(args.rules, base.rules),
        forbidden: prefer(args.forbidden, base.forbidden),
        toolPolicy: prefer(args.tool_policy, base.toolPolicy) as ToolPolicy,
        callableTools: callable.tools.length > 0 ? callable.tools : base.callableTools,
        toolSlots: callable.tools.length > 0 ? callable.slots : base.toolSlots,
        toolGuidance: prefer(args.tool_guidance, base.toolGuidance),
        toolFailure: prefer(args.tool_failure, base.toolFailure),
        outputSpec: resolveOutputSpec(args.output_spec, format, base.outputSpec),
        outputFormat: format,
        languageTone: prefer(args.language_tone, base.languageTone),
        fields: prefer(args.fields, base.fields),
        fallback: prefer(args.fallback, base.fallback),
        examples: prefer(args.examples, base.examples),
      }

      return Promise.resolve({
        prompt: buildSystemPrompt(form),
        template: chosen?.id ?? '',
        missing: validateForm(form),
      })
    },
  })
}

/**
 * 注册结构化提示词工具。
 * @param ctx - host 侧插件上下文。
 * @returns 取消注册的函数。
 */
export function registerStructuredPromptTool(ctx: HostPluginContext): () => void {
  return ctx.tools.register(createStructuredPromptTool())
}
