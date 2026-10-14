/**
 * 离线渲染测试用的 store 桩：实现 `defineStore` 的最小契约
 * （`create(scopeKey)` → 实例；实例暴露 getSnapshot / subscribe / actions）。
 *
 * 动作按「浅拷贝状态 → 交给声明式 mutator → 通知订阅者」执行，与宿主的
 * zustand + immer 语义在这条路径上等价（状态是 JSON 兼容的普通对象）。
 */

/** 深拷贝：状态树全部是 JSON 兼容值。 */
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * 声明一个 store。
 * @param decl - 含 `init` 与 `actions` 的声明。
 * @returns store 句柄。
 */
export function defineStore(decl) {
  return {
    spec: decl,
    create() {
      let state = decl.init()
      const listeners = new Set()
      const actions = {}
      for (const key of Object.keys(decl.actions)) {
        const mutate = decl.actions[key]
        actions[key] = (...params) => {
          const draft = clone(state)
          mutate(draft, ...params)
          state = draft
          for (const listener of [...listeners]) listener()
        }
      }
      return {
        actions,
        getSnapshot: () => state,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        clearPersisted: () => {},
      }
    },
  }
}
