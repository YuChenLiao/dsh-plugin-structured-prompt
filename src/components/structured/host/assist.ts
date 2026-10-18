/**
 * 自动填充（host 半边）：把一句简短需求扩写成结构化字段的增量补丁。
 *
 * 结果**不进主 agent 的上下文**：这条链路的发起方是 HTTP 路由（浏览器），结果也只回到浏览器。
 *
 * 两条执行路径，**单次调用优先**：
 *  1. `llm` 服务的 `stream()` —— 一次纯补全，没有工具、没有 agent loop，输出就是那段 JSON，
 *     也不在会话树里留子会话。前提是装载行配了 `assistProvider` + `assistModel`（DSH 的
 *     `GenerateOptions` 里这两项必填且无默认值）。
 *  2. 子代理（`subagents.start`）—— 零配置也能用，但它跑的是**完整 agent**，输出格式确定性更低，
 *     且会长出一个子会话。单次调用**失败时自动回退**到这条（例如某个 adapter 不接受我们构造的
 *     Message），所以"没验证过"不会变成"功能不可用"。
 *
 * 三条硬约束（两条路径共用）：
 *  - 模型输出**必须**过 `parseFormDocument` 的逐字段校验才落进表单；
 *  - 走子代理时 `parent` 必须是一个 Session（DSH `subagent/src/catalog.ts`），取不到报 409；
 *  - 提示词由 `buildAssistPrompt` 构造，素材整体 JSON 包裹。
 */
import { parseFormDocument } from '../shared/forms.js'
import type { PromptForm } from '../shared/types.js'
import type { StructuredPluginConfig } from './config.js'
import { generateText } from './assist-llm.js'
import type { LlmServiceLike } from './assist-llm.js'
import { buildAssistPrompt } from './assist-prompt.js'
import { extractJsonObject, findSession, narrowCurrent } from './assist-input.js'
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
  /** 实际走的是哪条路径（便于排障：`llm` 还是 `subagent`）。 */
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
 * 没有 import 关系（那条由渲染测试与安装自检共同守着），共享 4 行代码不值得破例。
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

/** 请求体的解析结果。 */
type ParsedRequest =
  | {
    readonly ok: true
    readonly brief: string
    readonly sessionId: string
    readonly current: Partial<PromptForm>
  }
  | { readonly ok: false; readonly failure: AssistFailure }

/**
 * 解析并校验请求体。
 * @param request - 浏览器请求。
 * @returns 合法时给出三个入参，否则给出可展示的失败。
 */
async function readRequest(request: Request): Promise<ParsedRequest> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { ok: false, failure: { error: '请求体不是 JSON', status: 400 } }
  }
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const brief = typeof record['brief'] === 'string' ? record['brief'].trim() : ''
  const sessionId = typeof record['sessionId'] === 'string' ? record['sessionId'] : ''
  if (brief === '') return { ok: false, failure: { error: '请先写一句需求', status: 400 } }
  if (brief.length > ASSIST_MAX_BRIEF) {
    return { ok: false, failure: { error: `需求太长（上限 ${ASSIST_MAX_BRIEF} 字）`, status: 413 } }
  }
  if (sessionId === '') {
    return { ok: false, failure: { error: '缺少 sessionId（子代理需要一个父级会话）', status: 400 } }
  }
  // 入参按字段白名单收窄：`as Partial<PromptForm>` 只是类型断言，运行期什么都不检查。
  return { ok: true, brief, sessionId, current: narrowCurrent(record['current']) }
}

/**
 * 跑一次扩写。
 * @param ctx - host 上下文。
 * @param request - 浏览器请求。
 * @param config - 装载行配置（单次调用路径的模型路由来自这里）。
 * @returns 成功时给出补丁，失败时给出可展示的原因与状态码。
 */
export async function runAssist(
  ctx: AssistContext,
  request: Request,
  config: StructuredPluginConfig = {},
): Promise<AssistOutcome | AssistFailure> {
  const parsedRequest = await readRequest(request)
  if (!parsedRequest.ok) return parsedRequest.failure
  const { brief, sessionId, current } = parsedRequest

  const llm = ctx.get?.('llm') as LlmServiceLike | undefined
  const subagents = ctx.get?.('subagents') as SubagentsServiceLike | undefined
  const route = config.assistProvider === undefined || config.assistModel === undefined
    ? undefined
    : { provider: config.assistProvider, model: config.assistModel }
  if (route === undefined && subagents === undefined) {
    return { error: '当前组装既没有配置自动填充的模型，也没有子代理服务', status: 501 }
  }

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(ASSIST_TIMEOUT_MS)])
  const prompt = buildAssistPrompt(brief, current)
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

  // 路径 2：子代理（零配置可用，或作为路径 1 的回退）。
  if (output === undefined) {
    if (subagents === undefined) {
      return { error: '单次调用失败，且当前组装没有子代理服务可回退', status: 502 }
    }
    const parent = findSession(ctx, sessionId)
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

  const parsed = extractJsonObject(output)
  if (parsed === undefined) {
    // 不猜、不修补：把模型原文截一段回去，让人看见它到底说了什么。
    return { error: `模型没有返回可解析的 JSON：${output.slice(0, 200)}`, status: 502 }
  }

  // 校验复用导入那条路径：未知键丢弃、类型不符丢弃、越界枚举改写，问题进 warnings。
  const { patch, warnings } = parseFormDocument(JSON.stringify(parsed))
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
        const result = await runAssist(scoped, request, config)
        return 'error' in result
          ? jsonResponse({ error: result.error }, result.status)
          : jsonResponse(result, 200)
      },
    })
  })
}
