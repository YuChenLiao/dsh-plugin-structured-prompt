/**
 * 自动填充的「单次调用」路径（**首选**）。
 *
 * 比走子代理轻得多：一次纯补全，没有工具、没有 agent loop，输出就是我们要的那段 JSON；
 * 也不会在会话树里留子会话。代价是必须指定 `provider` / `model` —— DSH 的 `GenerateOptions`
 * 里这两个字段都是必填且没有默认值来源，所以由装载行配置提供（`assistProvider` / `assistModel`）。
 *
 * **未经真实调用验证**：`Message` 的 `id` / `source` 是照最小形状构造的（host 产物零 import，
 * 拿不到 DSH 的类型与工厂）。若某个 adapter 对 `source` 有额外要求，这里会抛错 —— 调用方捕获后
 * **自动回退到子代理路径**，所以猜错不会变成"功能不可用"。
 */
/** `ctx.get('llm')` 的形状（只声明本模块用到的面）。 */
export interface LlmServiceLike {
  /**
   * 发起一次流式补全。
   * @param options - `GenerateOptions` 的子集：provider / model / messages / signal。
   * @returns 增量块流。
   */
  stream(options: Record<string, unknown>): AsyncIterable<unknown>
}

/** 一次单次调用的请求。 */
export interface LlmCallRequest {
  /** 模型路由（默认取自当前会话的模型选择）。 */
  readonly provider: string
  /** 模型名（默认取自当前会话的模型选择）。 */
  readonly model: string
  /** 完整提示词（系统指令与素材都在里面）。 */
  readonly prompt: string
  /** 推理强度：跟着当前会话走，免得两处不一致。 */
  readonly reasoningEffort?: string
  /** 取消信号。 */
  readonly signal: AbortSignal
}

/**
 * 收集流里的文本增量。
 *
 * 只认 `text-delta`：`reasoning-delta` 是思考过程、`tool-call-delta` 是工具调用，都不该进产物。
 * @param llm - llm 服务。
 * @param request - 请求。
 * @returns 拼好的文本。
 */
export async function generateText(llm: LlmServiceLike, request: LlmCallRequest): Promise<string> {
  // `Message` 的形状见 DSH `packages/llm/llm/src/message.ts`：id / role / content / source。
  // 后两个字段是品牌类型与生产者信息，这里给最小可用值（见文件头注释里的回退约定）。
  const message = {
    id: 'structured-prompt:autofill',
    role: 'user',
    content: [{ type: 'text', text: request.prompt }],
    source: { kind: 'plugin', plugin: 'dsh-plugin-structured-prompt' },
  }
  let text = ''
  for await (const chunk of llm.stream({
    provider: request.provider,
    model: request.model,
    messages: [message],
    signal: request.signal,
    ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
  })) {
    const record = chunk as { type?: unknown; text?: unknown }
    if (record.type === 'text-delta' && typeof record.text === 'string') text += record.text
  }
  return text
}
