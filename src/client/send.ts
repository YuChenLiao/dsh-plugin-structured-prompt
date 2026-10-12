/**
 * 把成稿发送进会话。
 *
 * 走会话作用域上下文里的 `conversation.send(text)`：它以排队轮次投递一条普通用户
 * 消息（正文就是成稿）。因此这里既不先写草稿、也不依赖输入框是否挂载 —— 原先
 * 「同步并返回」容易卡住的那类时序问题不再存在。
 *
 * 单独成模块，是为了让插件入口只保留装配职责。
 */
import type { ClientPluginContext, ScopedConversation, SessionsService } from './plugin-context.js'

/**
 * 把成稿发送进指定会话。
 *
 * 服务缺失（会话已销毁、`conversation` 未装配）或投递失败都只记录日志，不向上抛
 * —— 发送是弹窗的收尾动作，不该因为一次投递失败把界面拖垮。
 * @param ctx - 插件上下文。
 * @param sessionId - 目标会话。
 * @param prompt - 构建好的提示词。
 */
export function sendPrompt(ctx: ClientPluginContext, sessionId: string, prompt: string): void {
  try {
    // `sessions.scope(id)` 借出该会话的 Agent-scoped Context；`conversation` 是它
    // 上面的会话级服务。用 `get` + 显式判空读取：Cordis 的属性代理在服务缺失时
    // 可能抛错，而这里应当是"发不出去就记日志"的可降级路径。
    const scoped = (ctx.get('sessions') as SessionsService | undefined)?.scope?.(sessionId)
    const conversation = scoped?.get?.('conversation') as ScopedConversation | undefined
    if (conversation === undefined || typeof conversation.send !== 'function') {
      console.error('[structured-prompt] 无法发送：当前作用域取不到 conversation 服务', { sessionId })
      return
    }
    void conversation.send(prompt).catch((error: unknown) => {
      console.error('[structured-prompt] 发送提示词失败：', error)
    })
  } catch (error) {
    console.error('[structured-prompt] 发送提示词时异常：', error)
  }
}
