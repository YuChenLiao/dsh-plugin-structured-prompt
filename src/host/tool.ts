/**
 * 模型可调用的结构化提示词构建工具。
 *
 * 与客户端表单**共用** `src/shared/prompt.ts` 的构建逻辑，因此两个入口产出的提示词
 * 完全一致（段落顺序、省略规则、编号格式都是同一份实现）。参数与输出 schema 见
 * `parameters.ts`，参数收窄见 `args.ts`，纯构建见 `build.ts`。
 *
 * 默认只**产出**提示词；带 `delegate` 时改为**直投子代理**（见 `subagents.ts`）—— 那时
 * 提示词不再进入主上下文，这正是长提示词走这条路径的意义。
 *
 * **不 import 任何宿主包**：工具定义按 DSH 的 `ToolDefinition` 契约手工构造（理由见
 * `parameters.ts`）。这是本插件在 `link:` 安装下能正常激活的前提 —— 宿主包只能从
 * profile 的 node_modules 解析，而 link 经 junction 加载后 ESM 会 realpath 到源码目录，
 * 那里没有任何 node_modules。
 */
import { narrowArgs } from './args.js'
import { buildFromArgs } from './build.js'
import type { StructuredPromptValue } from './build.js'
import { TOOL_DESCRIPTION, TOOL_OUTPUT_SCHEMA, TOOL_PARAMETERS_SCHEMA } from './parameters.js'
import { resolveProviderName, runForeground } from './subagents.js'
import type { SubagentsServiceLike } from './subagents.js'

/** 模型可见的工具名。 */
export const STRUCTURED_PROMPT_TOOL = 'build_structured_prompt'

/** 内容块（本工具只用到文本块）。 */
export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** 工具的 canonical 输出值 = 构建结果 + 委托输出。 */
export interface StructuredPromptOutput extends StructuredPromptValue {
  /** 子代理的输出；未委托时为空串。 */
  readonly delegated: string
}

/**
 * 执行上下文（本工具只用到这两项）。
 *
 * `agent` 可选是有意的：非 agent 调用者没有可充当父级的 agent，此时 `delegate` 会被拒绝，
 * 而"只构建提示词"仍然可用。
 */
export interface ToolRunContextLike {
  /** 发起调用的 agent。 */
  readonly agent?: unknown
  /** 取消信号，会传给子代理运行。 */
  readonly signal: AbortSignal
}

/** 本插件用到的调用卡片形状（`generic` 卡片的最小可用子集）。 */
export interface ToolCallViewLike {
  readonly card: 'generic'
  /** 卡片标题：用本次构建的目标，比工具名更能说明在做什么。 */
  readonly title: string
  readonly kind: 'other'
  readonly rawInput: unknown
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
    render(args: unknown, value: StructuredPromptOutput): TextBlock[]
  }
  /**
   * 执行一次调用。
   * @param args - 模型传入的参数。
   * @param exec - 执行身份与取消信号；`delegate` 需要 `exec.agent` 作为父级。
   * @returns canonical 值。
   */
  execute(args: unknown, exec: ToolRunContextLike): Promise<StructuredPromptOutput>
  /**
   * 调用进行中的卡片。
   *
   * 必须**纯**且**容错**：界面在实时流与历史回放时都会调用它，参数可能是旧版本记录的
   * 形状。读不到目标时回退到工具名即可。
   * @param args - 解析后的调用参数（形状未经校验）。
   * @returns 卡片意图。
   */
  presentCall?(args: unknown): ToolCallViewLike | undefined
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
  /**
   * 可选读取一个服务。
   *
   * `subagents` 走这条路而不是写进 `inject`：没装配子代理 provider 的组装里，本插件仍要
   * 能提供"只构建提示词"的能力 —— 把可选能力写成硬依赖会让整个插件在那些组装里不激活。
   * @param name - 服务名。
   * @returns 服务实例；缺失时为 `undefined`。
   */
  get?(name: string): unknown
}

/**
 * 构造工具定义。
 *
 * 单独导出（而不是在模块顶层直接构造）是为了让测试能拿到定义直接调用 `execute` /
 * `render`，无需启动一个 Cordis 上下文。
 * @param ctx - host 侧插件上下文；省略时 `delegate` 会以"服务不可用"拒绝（其余能力不变）。
 * @returns registry-ready 的工具定义。
 */
export function createStructuredPromptTool(ctx?: HostPluginContext): ToolDefinitionLike {
  return {
    name: STRUCTURED_PROMPT_TOOL,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS_SCHEMA,
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: (_args, value) => {
        if (value.delegated !== '') {
          // 委托时提示词已投给子代理、不再回传（这正是这条路径省上下文的原因）。
          return [{
            type: 'text',
            text: `Delegated to a subagent; the built prompt was not added to this context.\n\n---\n${value.delegated}`,
          }]
        }
        return [{
          type: 'text',
          text: value.missing.length === 0
            ? value.prompt
            : `${value.prompt}\n\n---\n(Required field(s) still empty: ${value.missing.join(', ')}.)`,
        }]
      },
    },
    async execute(args, exec) {
      const narrowed = narrowArgs(args)
      const built = buildFromArgs(narrowed)
      const delegate = narrowed.delegate
      if (delegate === undefined) return { ...built, delegated: '' }

      // 可选读取：没装配子代理 provider 的 profile 里，"只构建提示词"仍要可用。
      const subagents = ctx?.get?.('subagents') as SubagentsServiceLike | undefined
      if (subagents === undefined) {
        throw new Error(
          'cannot delegate: the "subagents" service is not available in this composition; '
          + 'call without `delegate` to get the prompt instead',
        )
      }
      if (exec.agent === undefined) {
        throw new Error('cannot delegate: this call has no owning agent to act as the parent')
      }
      const providerName = resolveProviderName(subagents, delegate.provider)
      const outcome = await runForeground(
        subagents,
        providerName,
        built.prompt,
        delegate.label ?? STRUCTURED_PROMPT_TOOL,
        exec.agent,
        exec.signal,
      )
      return { ...built, delegated: outcome.output }
    },
    /**
     * 用本次构建的目标做标题 —— 比工具名更能说明"在构建什么"。
     *
     * 刻意**不提供** `presentResult`：结果是整段提示词，通用卡片会沿用这个标题并直接读
     * durable 内容，再写一份 presentResult 只是把同一段大文本塞进视图载荷（DSH 的
     * `run_code` 工具也是这个取舍）。
     * @param args - 调用参数（形状未经校验，历史回放的参数可能与当前版本不同）。
     * @returns 卡片意图。
     */
    presentCall(args) {
      const goal = typeof args === 'object' && args !== null
        ? (args as { goal?: unknown }).goal
        : undefined
      const title = typeof goal === 'string' && goal.trim() !== ''
        ? goal.trim()
        : STRUCTURED_PROMPT_TOOL
      return { card: 'generic', title, kind: 'other', rawInput: args }
    },
  }
}

/**
 * 注册结构化提示词工具。
 * @param ctx - host 侧插件上下文。
 * @returns 服务的返回值（取消注册函数）。
 */
export function registerStructuredPromptTool(ctx: HostPluginContext): unknown {
  return ctx.tools.register(createStructuredPromptTool(ctx))
}
