/**
 * 结构化组件与提示词库组件之间的**一次性交接**。
 *
 * 只有一个用途：库那边把"从原文转化出的字段补丁"交给表单这边，然后表单打开、字段已经填好。
 *
 * 为什么需要它：两个组件各有自己的 store（拆分时刻意如此，否则又会变回一个大 store）。但"把库里
 * 的提示词搬进表单"这件事天然要跨过这条边界。这里选择**一次性事件**而不是共享状态：
 *  - 共享状态会让两边都依赖"某个共享对象里现在是什么"，退化成隐式耦合；
 *  - 一次性事件只在交接的那一瞬存在，收不到就丢掉 —— 不会留下需要清理的残留。
 *
 * 刻意不引入任何反应式容器：一个 `Set` 加两个函数足够，也便于离线断言。
 */
import type { PromptForm } from '../components/structured/shared/types.js'

/** 补丁的交接回调。 */
export type FormPatchListener = (patch: Partial<PromptForm>) => void

/** 当前订阅者。用 `Set` 而不是数组：重复订阅要幂等，退订也不该受顺序影响。 */
const listeners = new Set<FormPatchListener>()

/**
 * 订阅交接。返回退订函数。
 * @param listener - 收到补丁时的回调。
 * @returns 退订函数（重复调用无害）。
 */
export function onFormPatch(listener: FormPatchListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * offer 一个补丁给所有订阅者。
 *
 * 没有订阅者时静默丢弃：这说明表单组件当前没挂载（例如会话里没有输入区），
 * 此时"打开表单并填好"本来也无处呈现 —— 而不是留个队列等它回来。
 * @param patch - 字段补丁。
 * @returns 实际投递到的订阅者数量（便于测试与排障）。
 */
export function offerFormPatch(patch: Partial<PromptForm>): number {
  let delivered = 0
  for (const listener of listeners) {
    listener(patch)
    delivered += 1
  }
  return delivered
}

/**
 * 清空所有订阅者（只给测试用，避免用例之间互相污染）。
 */
export function resetFormPatchListeners(): void {
  listeners.clear()
}
