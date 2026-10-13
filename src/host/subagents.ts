/**
 * 直投子代理：通过 `ctx.subagents` 启动一次**前台**委托并收集结果。
 *
 * 与官方 `subagent` 工具走同一条服务路径（`ctx.subagents.start`），因此继承它的 provider
 * 能力与语义；区别只在于提示词由本工具构建、**不必再经过主上下文**。
 *
 * 刻意**不用硬依赖**（不写进 `inject`）：没装配子代理 provider 的 profile 里，本插件仍要
 * 能提供"只构建提示词"的能力。所以走 `ctx.get('subagents')`，缺失时由 `delegate` 报错并
 * 列出可选项 —— 把可选能力写成硬依赖会让整个插件在那些组装里静默不激活。
 *
 * 前台 run 的收尾照官方 `settleForegroundRun` 的做法：结果与 `dispose()` **并行** settle，
 * 两者都失败时抛 `AggregateError`，避免用清理失败掩盖真正的执行失败。
 */

/** 内容块（本模块只处理文本块）。 */
export interface TextBlockLike {
  readonly type: 'text'
  readonly text: string
}

/**
 * 首选 provider 名。
 *
 * 一次性的独立子代理，与"把任务交出去执行"的语义一致。DSH 的 base bundle 注册的
 * `spawn` 正是它；另一个候选 `fork` 会继承父会话上下文，用途不同。
 */
const PREFERRED_PROVIDER = 'spawn'

/** 子代理的终态结果。 */
export interface SubagentResultLike {
  readonly output: readonly unknown[]
  readonly diagnostic?: string
  readonly stopReason: string
}

/** 一次子代理运行。 */
export interface SubagentRunLike {
  /** 子会话 id。 */
  readonly id: string
  /** 终态结果；拒绝即表示运行本身失败。 */
  readonly result: Promise<SubagentResultLike>
  /** 释放这次运行；前台调用**必须**调用它。 */
  dispose(): Promise<void>
}

/** 已注册的子代理 provider（只用到名字与存在性）。 */
export interface SubagentProviderLike {
  readonly name: string
}

/** `start()` 的请求（只声明本模块传入的字段）。 */
export interface SubagentStartRequestLike {
  readonly label: string
  readonly prompt: readonly TextBlockLike[]
  /** 发起委托的 agent。 */
  readonly parent: unknown
  readonly signal: AbortSignal
}

/** `ctx.get('subagents')` 的形状。 */
export interface SubagentsServiceLike {
  /** 已注册的 provider 名（插入顺序）。 */
  list(): string[]
  /**
   * 按名查找 provider。
   * @param name - provider 名。
   */
  getProvider(name: string): SubagentProviderLike | undefined
  /**
   * 在指定 provider 上启动一次委托。
   * @param name - provider 名。
   * @param request - 委托请求。
   */
  start(name: string, request: SubagentStartRequestLike): Promise<SubagentRunLike>
}

/** 一次委托的结果。 */
export interface DelegationOutcome {
  /** 实际使用的 provider 名。 */
  readonly provider: string
  /** 子会话 id。 */
  readonly runId: string
  /** 子代理的文本输出（拼接）。 */
  readonly output: string
  /** 终态原因。 */
  readonly stopReason: string
  /** provider 给出的诊断文本（若有）。 */
  readonly diagnostic?: string
}

/**
 * 选出要用的 provider。
 *
 * 不引入配置项：只有一个 provider 时直接用它；多个时要求显式指定（错误信息会把可选值
 * 列出来，调用方据此重试）；一个都没有说明该组装没装配子代理能力。
 * @param subagents - 子代理服务。
 * @param requested - 调用方指定的 provider 名（可选）。
 * @returns 生效的 provider 名。
 * @throws {Error} 未注册任何 provider、或指定了不存在的名字时。
 */
export function resolveProviderName(
  subagents: SubagentsServiceLike,
  requested: string | undefined,
): string {
  // provider 名来自配置，先规范化再比较 —— 否则 "spawn " 会被判成未知。
  const names = subagents.list().map(name => name.trim()).filter(name => name !== '')
  if (requested !== undefined) {
    const wanted = requested.trim()
    if (!names.includes(wanted)) {
      throw new Error(
        `unknown subagent provider "${wanted}"; available: ${names.join(', ') || '(none)'}`,
      )
    }
    return wanted
  }
  const [first] = names
  if (first === undefined) {
    throw new Error('no subagent provider is registered in this composition; cannot delegate')
  }
  // 有默认值，而不是"多个候选就报错"：DSH 的 base bundle 同时注册 `spawn` 与 `fork`
  // （`packages/bundle/base/cordis.patch.yml`），要求调用方显式指定等于让这个功能开箱
  // 不可用；而 `fork` 会继承父会话上下文，与"把任务独立交出去"的语义相反，不适合作默认。
  return names.includes(PREFERRED_PROVIDER) ? PREFERRED_PROVIDER : first
}

/**
 * 一个非 `completed` 的终态原因都算没干净收尾。
 *
 * 与官方实现一致：未知原因也按失败处理，而不是把部分输出当成成功。
 * @param stopReason - 终态原因。
 * @returns 失败说明；`completed` 时返回 `undefined`。
 */
function stopReasonError(stopReason: string): string | undefined {
  switch (stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      return 'subagent run was cancelled'
    case 'error':
      return 'subagent run failed'
    case 'max-tokens':
      return 'subagent run hit its token limit before finishing'
    case 'refusal':
      return 'subagent declined the task'
    default:
      return `subagent run ended abnormally (${stopReason})`
  }
}

/**
 * 拼接子代理输出里的文本块。
 * @param blocks - 结果里的内容块。
 * @returns 拼接后的文本。
 */
function textOf(blocks: readonly unknown[]): string {
  return blocks
    .filter((block): block is TextBlockLike =>
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * 把终态结果整理成委托结果；失败原因与部分输出分开呈现。
 * @param runId - 子会话 id。
 * @param result - 终态结果。
 * @returns 委托结果。
 */
function toOutcome(provider: string, runId: string, result: SubagentResultLike): DelegationOutcome {
  return {
    provider,
    runId,
    output: textOf(result.output),
    stopReason: result.stopReason,
    ...(result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic }),
  }
}

/**
 * 启动一次前台委托并收集结果，结束后释放运行。
 * @param subagents - 子代理服务。
 * @param providerName - 生效的 provider 名。
 * @param prompt - 已构建的提示词（正文即委托任务）。
 * @param label - 子代理任务的短标签。
 * @param parent - 发起委托的 agent。
 * @param signal - 调用方取消信号。
 * @returns 委托结果。
 * @throws {Error} 子代理未干净收尾时（说明里带上诊断与部分输出）。
 */
export async function runForeground(
  subagents: SubagentsServiceLike,
  providerName: string,
  prompt: string,
  label: string,
  parent: unknown,
  signal: AbortSignal,
): Promise<DelegationOutcome> {
  const run = await subagents.start(providerName, {
    label,
    prompt: [{ type: 'text', text: prompt }],
    parent,
    signal,
  })

  const [execution] = await Promise.allSettled([
    run.result.then((result) => {
      const failure = stopReasonError(result.stopReason)
      if (failure === undefined) return toOutcome(providerName, run.id, result)
      const outcome = toOutcome(providerName, run.id, result)
      const diagnostic = outcome.diagnostic === undefined ? '' : `\nDiagnostic: ${outcome.diagnostic}`
      const partial = outcome.output === '' ? '' : `\nPartial output before the run ended:\n${outcome.output}`
      throw new Error(`${failure}${diagnostic}${partial}`)
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])

  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}
