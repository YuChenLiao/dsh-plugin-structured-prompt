/**
 * 自动填充（host 半边）：把**一句话需求**或**一段现成提示词**转成结构化字段的增量补丁。
 *
 * 结果**不进主 agent 的上下文**：这条链路的发起方是 HTTP 路由（浏览器），结果也只回到浏览器。
 *
 * 两种动作共用同一条链路，只有提示词不同：
 *  - `expand` —— 一句话 → 字段（`buildAssistPrompt`）；
 *  - `convert` —— 提示词库里的成品提示词 → 字段（`buildConvertPrompt`，强调"搬运而不是改写"）。
 *
 * 执行路径**单次调用优先**：
 *  1. `llm` 服务的 `stream()` —— 一次纯补全，没有工具、没有 agent loop，输出就是那段 JSON，
 *     也不在会话树里留子会话。模型**继承当前对话**（`readSessionModel`），通常无需配置。
 *  2. 子代理（`subagents.start`）—— 保留作为回退，但**当前 DSH 版本不向插件暴露 `start`**
 *     （`SubagentRuntime extends TypertRemoteService` 且 `start` 没有 `@Remote`），实测不可用。
 *
 * 三条硬约束（共用）：
 *  - 模型输出**必须**过 `parseFormDocument` 的逐字段校验才落进表单；
 *  - 提示词里的素材整体 JSON 包裹，分隔符无法伪造边界；
 *  - 入参按 `FIELD_SHAPES` 白名单收窄。
 */
import { parseFormDocument } from '../shared/forms.js'
import type { PromptForm } from '../shared/types.js'
import type { StructuredPluginConfig } from './config.js'
import { generateText } from './assist-llm.js'
import type { LlmServiceLike } from './assist-llm.js'
import { buildAssistPrompt } from './assist-prompt.js'
import { buildConvertPrompt } from './assist-convert-prompt.js'
import { extractJsonObject, findSession, parseAssistRequest } from './assist-input.js'
import type { AssistRequest } from './assist-input.js'
import { readDefaultModel, readSessionModel } from './assist-model.js'
import { resolveProviderName, runForeground } from './subagents.js'
import type { SubagentsServiceLike } from './subagents.js'

/** 本组件的扩写路由（同源，挂在与检索路由同一套 connection 通道上）。 */
export const ASSIST_ROUTE_PATH = '/api/structured-prompt/assist'

/** 一次扩写的等待上限：子代理是一整个会话，比单次调用慢得多。 */
export const ASSIST_TIMEOUT_MS = 90_000

/** 一句话需求的最大长度（字符）。超出直接拒绝，避免把整篇文档塞进来。 */
export const ASSIST_MAX_BRIEF = 4_000

// 提取逻辑在 assist-input.ts；这里转出去，调用方（含测试）只认 assist.ts 这个入口。
export { extractJsonObject } from './assist-input.js'

/** 扩写结果。 */
export interface AssistOutcome {
  /** 可落进表单的增量补丁（已过校验）。 */
  readonly patch: Partial<PromptForm>
  /** 校验时丢弃/改写的内容说明；没有问题则为空数组。 */
  readonly warnings: readonly string[]
  /** 实际走的标识：单次调用给 `provider/model`，子代理给 provider 名。 */
  readonly provider: string
  /** 实际走的是哪条路径（便于排障）。 */
  readonly via: 'llm' | 'subagent'
}

/** 扩写失败。 */
export interface AssistFailure {
  /** 可直接展示的原因。 */
  readonly error: string
  /** HTTP 状态码。 */
  readonly status: number
}

/** 路由上下文：只声明本模块用到的面（与检索路由同形，但刻意不跨组件 import）。 */
export interface AssistContext {
  readonly get?: (name: string) => unknown
  readonly effect?: (callback: () => () => void, label?: string) => void
  readonly inject?: (deps: readonly string[], callback: (scoped: AssistContext) => void) => unknown
}

/**
 * 一个最小的 JSON 响应。
 *
 * 与 `components/library/host/library-upstream.ts` 里的同形 —— 刻意**各自一份**：两个组件之间
 * 没有 import 关系，共享 4 行代码不值得破例。
 * @param body - 响应体。
 * @param status - HTTP 状态码。
 * @returns 响应对象。
 */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * 按动作构造提示词。
 * @param request - 已校验的入参。
 * @returns 交给模型的完整提示词。
 */
function promptFor(request: AssistRequest): string {
  return request.action === 'convert'
    ? buildConvertPrompt(request.source, request.title)
    : buildAssistPrompt(request.brief, request.current)
}

/**
 * 跑一次转化 / 扩写。
 * @param ctx - host 上下文。
 * @param request - 浏览器请求。
 * @param config - 装载行配置（模型回退项）。
 * @returns 成功时给出补丁，失败时给出可展示的原因与状态码。
 */
export async function runAssist(
  ctx: AssistContext,
  request: Request,
  config: StructuredPluginConfig = {},
  outer?: AssistContext,
): Promise<AssistOutcome | AssistFailure> {
  const parsed = await parseAssistRequest(request, { maxBrief: ASSIST_MAX_BRIEF })
  if (!parsed.ok) return parsed.failure
  const assistRequest = parsed.request

  const llm = ctx.get?.('llm') as LlmServiceLike | undefined
  const subagents = ctx.get?.('subagents') as SubagentsServiceLike | undefined
  // 模型来源优先级：**当前会话正在用的模型** → **宿主的默认模型** → 装载行配置 → 都没有。
  //
  // 两个上下文都试：本函数拿到的是 `ctx.inject(['connection'], scoped => …)` 的作用域上下文，
  // 它未必看得到 `sessions` / `sessionProjections` 这类宿主服务，而外层上下文往往看得到。
  //
  // 中间那一级是必需的：**新会话还没有模型选择**（用户没切换过、也还没发过请求），`modelSelection`
  // 投影的 `lastUsed` 与 `pending` 都是 null。DSH 自己的回退链是
  // `pending → 会话 requestHeader → agentDefaultModel`，这里对齐它的最后一级。
  const contexts = outer === undefined ? [ctx] : [ctx, outer]
  const lookup = readSessionModel(contexts, assistRequest.sessionId)
  const fallbackLookup = lookup.selection === undefined ? readDefaultModel(contexts) : undefined
  const sessionModel = lookup.selection ?? fallbackLookup?.selection
  const route = sessionModel ?? (config.assistProvider === undefined || config.assistModel === undefined
    ? undefined
    : { provider: config.assistProvider, model: config.assistModel })
  if (route === undefined && subagents === undefined) {
    // 把"卡在哪一步"写进错误消息：只说"读不到模型"没法定位。
    return {
      error: `读不到可用的模型（会话模型：${lookup.reason ?? '已取到'}；`
        + `默认模型：${fallbackLookup?.reason ?? (lookup.selection === undefined ? '未尝试' : '已取到')}）；`
        + '也没有配置 assistProvider / assistModel',
      status: 501,
    }
  }

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(ASSIST_TIMEOUT_MS)])
  const prompt = promptFor(assistRequest)
  let output: string | undefined
  let provider = ''
  let via: 'llm' | 'subagent' | undefined

  // 路径 1：单次调用。失败**不立刻报错** —— 回退到子代理再试，否则"某个 adapter 不接受我们
  // 构造的 Message"会直接表现为功能不可用。
  if (route !== undefined && llm !== undefined) {
    try {
      output = await generateText(llm, { ...route, prompt, signal })
      provider = `${route.provider}/${route.model}`
      via = 'llm'
    } catch {
      output = undefined
    }
  }

  // 路径 2：子代理（回退）。
  if (output === undefined) {
    const canDelegate = subagents !== undefined
      && typeof (subagents as unknown as Record<string, unknown>)['start'] === 'function'
    if (!canDelegate) {
      // 三种情况分开报：把"没有 llm 服务"说成"单次调用失败"会让人往错的方向查。
      // 实测背景：`SubagentRuntime` 是 `TypertRemoteService`，`start` 没有 `@Remote` 标注，
      // 插件侧拿到的句柄上没有它 —— 所以回退路径在该版本不可用。
      return {
        error: llm === undefined
          ? '当前组装没有 llm 服务，无法发起模型调用'
          : route === undefined
            ? '读不到当前对话的模型，也没有配置 assistProvider / assistModel'
            : '单次调用失败，且当前 DSH 版本的子代理服务不向插件暴露 start()，没有可回退的路径',
        status: 501,
      }
    }
    const parent = findSession(ctx, assistRequest.sessionId)
    if (parent === undefined) return { error: '取不到当前会话，无法启动子代理', status: 409 }
    let providerName: string
    try {
      providerName = resolveProviderName(subagents, config.provider)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), status: 501 }
    }
    try {
      const outcome = await runForeground(
        subagents, providerName, prompt, 'structured-prompt:autofill', parent, signal,
      )
      output = outcome.output
      provider = providerName
      via = 'subagent'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const timedOut = signal.aborted && !request.signal.aborted
      return {
        error: timedOut ? `扩写在 ${ASSIST_TIMEOUT_MS / 1000} 秒内没有完成` : message,
        status: timedOut ? 504 : 502,
      }
    }
  }

  const parsedOutput = extractJsonObject(output)
  if (parsedOutput === undefined) {
    // 不猜、不修补：把模型原文截一段回去，让人看见它到底说了什么。
    return { error: `模型没有返回可解析的 JSON：${output.slice(0, 200)}`, status: 502 }
  }

  // 校验复用导入那条路径：未知键丢弃、类型不符丢弃、越界枚举改写，问题进 warnings。
  const { patch, warnings } = parseFormDocument(JSON.stringify(parsedOutput))
  if (Object.keys(patch).length === 0) {
    return {
      error: `模型的输出没有可用字段${warnings.length === 0 ? '' : `（${warnings.join('; ')}）`}`,
      status: 502,
    }
  }
  return { patch, warnings, provider, via: via ?? 'subagent' }
}

/**
 * 注册扩写路由。
 *
 * 与检索路由同样是"可选服务"：`connection` 不在 `inject` 里，缺失时只跳过注册。
 * @param ctx - host 上下文。
 * @param config - 装载行配置。
 */
export function registerAssistRoute(ctx: AssistContext, config: StructuredPluginConfig): void {
  if (typeof ctx.inject !== 'function') {
    console.warn('[structured-prompt] 无可用的 ctx.inject，跳过自动填充路由注册')
    return
  }
  ctx.inject(['connection'], (scoped) => {
    const connection = scoped.get?.('connection') as {
      fetch?: { register?: (route: Record<string, unknown>) => void }
    } | undefined
    const register = connection?.fetch?.register
    if (typeof register !== 'function') return
    register({
      path: ASSIST_ROUTE_PATH,
      methods: ['POST'],
      async fetch(request: Request) {
        const result = await runAssist(scoped, request, config, ctx)
        return 'error' in result
          ? jsonResponse({ error: result.error }, result.status)
          : jsonResponse(result, 200)
      },
    })
  })
}
