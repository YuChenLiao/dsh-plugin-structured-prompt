/**
 * `@deepseek-ai/dsh-client-store` 的本地类型声明。
 *
 * 这个包在运行时由 DSH 的模块表提供（客户端 bundle 保留为 `require`），源码里
 * 只消费 `defineStore` 一个导出。这里声明本插件用到的那部分契约，而不是引入
 * DSH 的包 —— 插件的构建与类型检查因此不需要任何 workspace 依赖。
 *
 * 宿主对 `defineStore` 的完整语义（zustand + immer 引擎、按 handle × scope 缓存
 * 实例）见 DSH 源码 `packages/client/store/src/index.ts`。
 */
declare module '@deepseek-ai/dsh-client-store' {
  /**
   * 动作表：`draft` 之外的参数会原样传给绑定后的回调。
   *
   * 用 `any[]` 而不是 `never[]`：每个动作都有自己的参数表，`never[]` 会让
   * `(...params: never[])` 拒绝所有具体签名（严格函数类型下 `string` 不可赋给
   * `never`）。这里的 `any` 只出现在内部约束位置，不外泄到组件。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 见上方说明。
  export type ActionsDecl<T> = Record<string, (draft: T, ...params: any[]) => void>

  /** 去掉 `draft` 参数后的动作视图（组件与注入面拿到的形态）。 */
  export type BakedActions<A> = {
    [K in keyof A]: A[K] extends (draft: never, ...params: infer P) => void ? (...params: P) => void : never
  }

  /** store 声明：初始状态工厂与动作表。 */
  export interface StoreSpec<T, A> {
    init: () => T
    persist?: string
    actions: A
  }

  /** live 实例：裸快照源 + 绑定后的写集。 */
  export interface StoreInstance<T, A> {
    readonly actions: BakedActions<A>
    getSnapshot(): T
    subscribe(fn: () => void): () => void
    clearPersisted(): void
  }

  /** store 句柄：注册时的 `store` 座位。 */
  export interface StoreHandle<T, A> {
    readonly spec: StoreSpec<T, A>
    create(scopeKey?: string): StoreInstance<T, A>
  }

  /**
   * 快照选择器 hook：渲染器把 store 实例绑定成这个形态。
   *
   * 组件通过槽位 props 收到它（由注册声明的 `store` 座位注入），因此不需要引入
   * ui-slots 的类型包。
   */
  export type SnapshotSelectorHook<T> = <S>(selector: (state: T) => S) => S

  /**
   * 声明一个 store。
   *
   * 泛型只要求 `A` 是「以 `draft` 为首参的函数表」，而不要求它是一个带字符串
   * 索引签名的 `Record` —— 调用方通常传入一个具名 interface（没有索引签名），
   * 那样更精确也更好读。
   * @param decl - 初始状态工厂与动作表。
   * @returns store 句柄。
   */
  export function defineStore<T, A>(
    decl: StoreSpec<T, ActionsDecl<T> & A> & { actions: A },
  ): StoreHandle<T, ActionsDecl<T> & A>
}
