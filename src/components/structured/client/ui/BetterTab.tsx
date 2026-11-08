/**
 * `dsh-better-sidebar` 里本插件 tab 的主体。
 *
 * 它与宿主原生右侧栏那个 tab 主体（`SidebarForm.tsx`）渲染的是**同一份** `FormPanel`，差别只在
 * 状态从哪来：
 *  - 插槽组件由渲染器注入 `useStore` / `actions`（座位 `store`）；
 *  - 这里的 tab 主体不是插槽，只能自己从 store 句柄取实例 —— 而 `createStructuredInputStore`
 *    按 `scopeKey` 缓存实例，所以拿到的就是插槽渲染器那一份，入口按钮、弹窗、两个侧栏共享状态。
 */
import { useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { StructuredState } from '../../shared/types.js'
import type { StructuredInputStore } from '../store.js'
import { StructuredSidebarForm } from './SidebarForm.js'

/** tab 主体的 props（由描述符的 `component` 闭包提供）。 */
export interface StructuredBetterTabProps {
  /** store 句柄（同一个句柄的两处 `create` 会拿到同一实例）。 */
  readonly store: StructuredInputStore
  /** 发送链路。 */
  readonly send: (sessionId: string, prompt: string) => void
  /** 会话标识；`undefined` 时不渲染（会话 tab 才有意义）。 */
  readonly sessionId?: string | undefined
}

/**
 * tab 主体。
 * @param props - store 句柄、发送链路与会话标识。
 * @returns 表单本体，或没有会话时的 `null`。
 */
export function StructuredBetterTab({ store, send, sessionId }: StructuredBetterTabProps): ReactNode {
  // 句柄按 scopeKey 缓存实例，所以这里可以放心 `useMemo`：同一会话永远是同一个实例。
  const instance = useMemo(() => store.create(sessionId), [store, sessionId])
  /**
   * `eq` 的记忆槽。
   *
   * `useSyncExternalStore` 要求 `getSnapshot` 返回**稳定引用**。本组件现有的四个选择器都取
   * immer 的稳定引用，但 `SnapshotSelectorHook` 的公开形状带 `eq` —— 将来有人写
   * `useStore(s => ({ a: s.a }), shallowEqual)`，没有这层记忆就会每次返回新对象，React 直接抛
   * "The result of getSnapshot should be cached"。
   */
  const useStore = useMemo(() => {
    /** 上一次（选择器 → 结果）。 */
    const cache: { selector?: unknown; value?: unknown } = {}
    /**
     * 与插槽渲染器注入的 `useStore` 同形：选择器（可选 `eq`）+ 订阅。
     * @param selector - 从状态里取值。
     * @param eq - 判定"新值与上次等价"的函数；给了就复用上次的对象引用。
     * @returns 选择器的结果。
     */
    return <R,>(selector: (state: StructuredState) => R, eq?: (a: R, b: R) => boolean): R => {
      /**
       * 读一次快照。
       * @returns 选择器的结果；`eq` 判等成功时返回上一次的对象。
       */
      const read = (): R => {
        const next = selector(instance.getSnapshot())
        if (eq !== undefined && cache.selector === selector && eq(cache.value as R, next)) {
          return cache.value as R
        }
        cache.selector = selector
        cache.value = next
        return next
      }
      // 第三个参数是服务端快照：离线渲染测试走 `renderToStaticMarkup`，没有订阅，React 要求显式给出。
      return useSyncExternalStore(instance.subscribe, read, read)
    }
  }, [instance])
  return (
    <StructuredSidebarForm
      useStore={useStore}
      actions={instance.actions}
      send={send}
      sessionId={sessionId}
    />
  )
}
