/**
 * 自动填充（host 半边）：跑一次子代理，把一句简短需求扩写成结构化字段的增量补丁。
 *
 * 结果**不进主 agent 的上下文**：这条链路的发起方是 HTTP 路由（浏览器），结果也只回到浏览器，
 * 主对话里看不到任何内容。
 *
 * 三条硬约束：
 *  1. 子代理的 `parent` 必须是一个 **Session**（DSH 的 `subagent/src/catalog.ts` 里是
 *     `parent: Session`），所以请求必须带 `sessionId`；host 侧按它**探测**取 Session（不同版本
 *     取法不同），拿不到就明确报错，绝不编一个假父级。
 *  2. 模型输出**必须**过 `parseFormDocument` 的逐字段校验才落进表单 —— 非法字段被丢弃、问题原样
 *     回传，绝不"看起来像就采用"。
 *  3. 提示词由 {@link buildAssistPrompt} 构造，字段清单从 `FIELD_SHAPES` 动态生成。
 *
 * 放 host 半边而不是客户端，是因为模型调用、Session 探测、跑子代理都只在宿主侧存在；浏览器那边
 * 只发一个 POST 并渲染结果。
 */
import { parseFormDocument } from '../shared/forms.js'
import type { PromptForm } from '../shared/types.js'
import { buildAssistPrompt } from './assist-prompt.js'
import { resolveProviderName, runForeground } from './subagents.js'
import type { SubagentsServiceLike } from './subagents.js'

/** 本组件的扩写路由（同源，挂在与检索路由同一套 connection 通道上）。 */
export const ASSIST_ROUTE_PATH = '/api/structured-prompt/assist'

/** 一次扩写的等待上限：子代理是一整个会话，比检索慢得多。 */
export const ASSIST_TIMEOUT_MS = 90_000

/** 一句话需求的最大长度（字符）。超出直接拒绝，避免把整篇文档塞进来。 */
export const ASSIST_MAX_BRIEF = 4_000

/** 扩写结果。 */
export interface AssistOutcome {
  /** 可落进表单的增量补丁（已过校验）。 */
  readonly patch: Partial<PromptForm>
  /** 校验时丢弃/改写的内容说明；没有问题则为空数组。 */
  readonly warnings: readonly string[]
  /** 实际使用的 provider 名，便于用户判断是哪个子代理干的。 */
  readonly provider: string
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
 * 从模型输出里提取 JSON 对象。
 *
 * 模型常把 JSON 包在 ```json 围栏里、或在前后加一句话。这里只做"定位最外层花括号"这一件事：
 * **不做任何启发式修补** —— 修补过的 JSON 会把错误藏起来。
 * @param text - 模型输出。
 * @returns 解析出的对象；找不到或解析失败时为 `undefined`。
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 按 id 探测取出 Session（不同 DSH 版本的取法不同，这里逐个试）。
 * @param ctx - host 上下文。
 * @param sessionId - 目标会话。
 * @returns Session；取不到时为 `undefined`。
 */
function findSession(ctx: AssistContext, sessionId: string): unknown {
  const sessions = ctx.get?.('sessions') as Record<string, unknown> | undefined
  if (sessions === undefined) return undefined
  for (const name of ['get', 'byId', 'find', 'resolve']) {
    const fn = sessions[name]
    if (typeof fn !== 'function') continue
    const value = (fn as (id: string) => unknown).call(sessions, sessionId)
    if (value !== undefined && value !== null) return value
  }
  // 会话作用域上下文上可能挂着 session 本体。
  const scope = typeof sessions['scope'] === 'function'
    ? (sessions['scope'] as (id: string) => Record<string, unknown> | undefined).call(sessions, sessionId)
    : undefined
  const owned = scope?.['session']
  if (owned !== undefined) return owned
  const viaGet = typeof scope?.['get'] === 'function'
    ? (scope['get'] as (name: string) => unknown).call(scope, 'session')
    : undefined
  return viaGet ?? undefined
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

/**
 * 跑一次扩写。
 * @param ctx - host 上下文。
 * @param request - 浏览器请求。
 * @returns 成功时给出补丁，失败时给出可展示的原因与状态码。
 */
export async function runAssist(ctx: AssistContext, request: Request): Promise<AssistOutcome | AssistFailure> {
  const subagents = ctx.get?.('subagents') as SubagentsServiceLike | undefined
  if (subagents === undefined) {
    return { error: '当前组装没有子代理服务，自动填充不可用', status: 501 }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { error: '请求体不是 JSON', status: 400 }
  }
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const brief = typeof record['brief'] === 'string' ? record['brief'].trim() : ''
  const sessionId = typeof record['sessionId'] === 'string' ? record['sessionId'] : ''
  if (brief === '') return { error: '请先写一句需求', status: 400 }
  if (brief.length > ASSIST_MAX_BRIEF) {
    return { error: `需求太长（上限 ${ASSIST_MAX_BRIEF} 字）`, status: 413 }
  }
  if (sessionId === '') return { error: '缺少 sessionId（子代理需要一个父级会话）', status: 400 }

  const parent = findSession(ctx, sessionId)
  if (parent === undefined) return { error: '取不到当前会话，无法启动子代理', status: 409 }

  let provider: string
  try {
    provider = resolveProviderName(subagents, undefined)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), status: 501 }
  }

  const current = (typeof record['current'] === 'object' && record['current'] !== null
    ? record['current']
    : {}) as Partial<PromptForm>

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(ASSIST_TIMEOUT_MS)])
  let output: string
  try {
    const outcome = await runForeground(
      subagents, provider, buildAssistPrompt(brief, current), 'structured-prompt:autofill', parent, signal,
    )
    output = outcome.output
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const timedOut = signal.aborted && !request.signal.aborted
    return {
      error: timedOut ? `子代理在 ${ASSIST_TIMEOUT_MS / 1000} 秒内没有完成` : message,
      status: timedOut ? 504 : 502,
    }
  }

  const parsed = extractJsonObject(output)
  if (parsed === undefined) {
    // 不猜、不修补：把模型原文截一段回去，让人看见它到底说了什么。
    return { error: `子代理没有返回可解析的 JSON：${output.slice(0, 200)}`, status: 502 }
  }

  // 校验复用导入那条路径：未知键丢弃、类型不符丢弃、越界枚举改写，问题进 warnings。
  const { patch, warnings } = parseFormDocument(JSON.stringify(parsed))
  if (Object.keys(patch).length === 0) {
    return {
      error: `子代理的输出没有可用字段${warnings.length === 0 ? '' : `（${warnings.join('; ')}）`}`,
      status: 502,
    }
  }
  return { patch, warnings, provider }
}

/**
 * 注册扩写路由。
 *
 * 与检索路由同样是"可选服务"：`connection` 不在 `inject` 里，缺失时只跳过注册。
 * @param ctx - host 上下文。
 */
export function registerAssistRoute(ctx: AssistContext): void {
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
        const result = await runAssist(scoped, request)
        return 'error' in result
          ? jsonResponse({ error: result.error }, result.status)
          : jsonResponse(result, 200)
      },
    })
  })
}
