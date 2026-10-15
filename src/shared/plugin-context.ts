/**
 * 插件消费的 Cordis 上下文形态。
 *
 * 只声明本插件真正用到的成员，而不是引入 DSH 的包 —— 插件的构建与类型检查因此
 * 不需要任何 workspace 依赖。运行时由宿主提供真实上下文。
 */

/** 会话作用域上下文里的 `conversation` 服务。 */
export interface ScopedConversation {
  /**
   * 把提示词发进该会话。
   * @param text - 提示词正文。
   */
  send(text: string): Promise<void>
}

/**
 * 会话作用域上下文（`sessions.scope(id)` 的返回值）。
 *
 * 实际类型是 `AgentContext`（一个完整的 Cordis `Context`），这里只声明本插件要用
 * 的成员：`get` 严格读服务，供发送路径判空使用。
 */
export interface SessionScope {
  /**
   * 严格读取该作用域上的服务。
   * @param name - 服务名。
   */
  get?(name: string): unknown
  /** 会话级会话服务；会话已销毁时缺省（直接属性访问的兼容写法）。 */
  readonly conversation?: ScopedConversation
}

/** `sessions` 服务里本插件用到的部分。 */
export interface SessionsService {
  /**
   * 取某个会话的作用域上下文。
   * @param id - 会话标识。
   * @returns 作用域上下文，或该会话不存在时的 `undefined`。
   */
  scope?(id: string): SessionScope | undefined
}

/** 槽位注册面。 */
export interface SlotsService {
  /**
   * 等目标槽位被声明后注册。
   * @param key - 槽位键。
   * @param callback - 注册回调。
   */
  inject(key: string, callback: () => void): unknown
  /**
   * 注册一个槽位条目。
   * @param options - 注册选项。
   * @param component - 组件。
   */
  register(options: Record<string, unknown>, component: unknown): unknown
}

/** 本插件用到的 Cordis 上下文。 */
export interface ClientPluginContext {
  /**
   * 注册一个随插件 fiber 释放的副作用。
   * @param factory - 立即执行并返回清理函数的工厂。
   * @param label - 诊断标签。
   */
  effect(factory: () => void | (() => void), label: string): unknown
  /**
   * 严格读取服务；未挂载时返回 `undefined`。
   * @param name - 服务名。
   */
  get(name: string): unknown
  /** 槽位注册面。 */
  slots: SlotsService
}
