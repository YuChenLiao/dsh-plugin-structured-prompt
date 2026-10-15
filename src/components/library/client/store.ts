/**
 * 提示词库组件的会话状态。
 *
 * 与结构化组件**各自一个 store 句柄**：两个组件分别注册自己的槽位，因此不需要共享状态，也就
 * 没有了"一个 store 里塞着两种功能的状态"那种耦合（拆分前 `StructuredState` 里挂着 `library`
 * 字段）。状态形状本身是 `LibraryState`，不再嵌套。
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { StoreHandle } from '@deepseek-ai/dsh-client-store'
import { createLibraryState } from '../shared/library.js'
import type { LibraryState } from '../shared/library.js'

/** store 的动作表：`draft` 之外的参数会原样暴露给组件。 */
export interface LibraryComponentActionsDecl {
  /** 打开检索弹窗。 */
  open(draft: LibraryState): void
  /** 关闭检索弹窗（查询词与结果保留，便于再次进入）。 */
  close(draft: LibraryState): void
  /** 局部更新状态：请求开始 / 结果 / 失败都经它落下。 */
  patch(draft: LibraryState, patch: Partial<LibraryState>): void
  /** 回到列表视图（调用方负责让在途的详情响应作废）。 */
  backToList(draft: LibraryState): void
}

/** 本组件 store 的句柄类型。 */
export type LibraryStore = StoreHandle<LibraryState, LibraryComponentActionsDecl>

/**
 * 声明提示词库的 store。
 * @returns store 句柄。
 */
export function createLibraryStore(): LibraryStore {
  return defineStore<LibraryState, LibraryComponentActionsDecl>({
    init: createLibraryState,
    actions: {
      open: (draft) => { draft.active = true },
      close: (draft) => { draft.active = false },
      patch: (draft, patch) => { Object.assign(draft, patch) },
      backToList: (draft) => {
        draft.selectedId = ''
        draft.detail = null
        draft.detailStatus = 'idle'
        draft.failure = ''
      },
    },
  })
}
