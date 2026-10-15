/**
 * 结构化输入任务的会话状态。
 *
 * 两个槽位注册共用同一个 store 句柄：入口按钮（`conversation.input.left`）切换开关，
 * 弹窗（`conversation.input.dock`）按开关渲染 —— 表单与提示词库检索**互斥**，同时只开一个。
 * 实例由 Slot 渲染器按「handle × sessionId」缓存，因此几处共享同一实例，不需要跨注册的状态
 * 同步。
 *
 * 工具名与用途**按索引配对**（`callableTools[i]` ↔ `toolSlots[i]`），所以增删必须
 * 成对操作；`addTool` / `removeTool` 是唯一的成对入口，避免两个数组长度错位。
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { StoreHandle } from '@deepseek-ai/dsh-client-store'
import type { ListFieldKey, PromptForm, StructuredState } from '../shared/types.js'
import { completeForm, createEmptyForm } from '../shared/forms.js'
import { createLibraryState } from '../shared/library.js'
import type { LibraryState } from '../shared/library.js'

/**
 * 初始会话状态。
 *
 * 默认只展开「基础信息」，其余三组折叠 —— 避免表单一打开就铺满屏幕。
 * @returns 全新的初始状态。
 */
function emptyState(): StructuredState {
  return {
    active: false,
    form: createEmptyForm(),
    collapsed: ['rules', 'tools', 'output'],
    appliedTemplate: '',
    library: createLibraryState(),
  }
}

/** store 的动作表：`draft` 之外的参数会原样暴露给组件。 */
export interface StructuredActions {
  /** 打开表单弹窗（与检索弹窗互斥）。 */
  open(draft: StructuredState): void
  /** 关闭表单弹窗（表单内容保留，便于再次进入）。 */
  close(draft: StructuredState): void
  /** 打开提示词库检索弹窗（与表单弹窗互斥）。 */
  openLibrary(draft: StructuredState): void
  /** 关闭检索弹窗（查询词与结果保留，便于再次进入）。 */
  closeLibrary(draft: StructuredState): void
  /** 局部更新检索弹窗的状态：请求开始 / 结果 / 失败都经它落下。 */
  patchLibrary(draft: StructuredState, patch: Partial<LibraryState>): void
  /** 整表替换（模板填充 / JSON 导入）。 */
  setForm(draft: StructuredState, form: Partial<PromptForm>): void
  /** 写入单个字段；值的类型由字段名推导。 */
  setField<K extends keyof PromptForm>(draft: StructuredState, key: K, value: PromptForm[K]): void
  /** 数组字段追加一条。 */
  addItem(draft: StructuredState, key: ListFieldKey, value: string): void
  /** 数组字段改写第 index 条。 */
  setItem<K extends ListFieldKey>(draft: StructuredState, key: K, index: number, value: string): void
  /** 数组字段删除第 index 条。 */
  removeItem(draft: StructuredState, key: ListFieldKey, index: number): void
  /** 数组字段上下移动（delta 为 -1 或 1）。 */
  moveItem(draft: StructuredState, key: ListFieldKey, index: number, delta: number): void
  /** 追加一行工具（工具名与用途成对追加，保持索引对齐）。 */
  addTool(draft: StructuredState): void
  /** 删除第 index 行工具（两个数组同步删除）。 */
  removeTool(draft: StructuredState, index: number): void
  /** 切换分组折叠状态。 */
  toggleSection(draft: StructuredState, id: string): void
  /** 记录当前表单套用了哪套模板；空串表示不是模板套用状态（导入、手填都算）。 */
  setAppliedTemplate(draft: StructuredState, id: string): void
  /** 清空表单，回到空白状态。 */
  reset(draft: StructuredState): void
}

/** 本插件 store 的句柄类型。 */
export type StructuredInputStore = StoreHandle<StructuredState, StructuredActions>

/**
 * 声明结构化输入任务的 store。
 * @returns store 句柄，写集覆盖整表替换、字段写入、数组条目增删改序、分组折叠与检索弹窗状态。
 */
export function createStructuredInputStore(): StructuredInputStore {
  return defineStore<StructuredState, StructuredActions>({
    init: emptyState,
    actions: {
      open: (draft) => {
        draft.active = true
        // 两个弹窗互斥：从入口直接切过来时，另一个不能留在打开状态。
        draft.library.active = false
      },
      close: (draft) => { draft.active = false },
      openLibrary: (draft) => {
        draft.library.active = true
        draft.active = false
      },
      closeLibrary: (draft) => { draft.library.active = false },
      patchLibrary: (draft, patch) => { Object.assign(draft.library, patch) },
      setForm: (draft, form) => { draft.form = completeForm(form) },
      setField: (draft, key, value) => { draft.form[key] = value },
      addItem: (draft, key, value) => { draft.form[key].push(value) },
      setItem: (draft, key, index, value) => {
        if (index < 0 || index >= draft.form[key].length) return
        draft.form[key][index] = value
      },
      removeItem: (draft, key, index) => {
        if (index < 0 || index >= draft.form[key].length) return
        draft.form[key].splice(index, 1)
      },
      moveItem: (draft, key, index, delta) => {
        const items = draft.form[key]
        const next = index + delta
        if (index < 0 || index >= items.length || next < 0 || next >= items.length) return
        const moved = items.splice(index, 1)[0]
        if (moved === undefined) return
        items.splice(next, 0, moved)
      },
      addTool: (draft) => {
        draft.form.callableTools.push('')
        draft.form.toolSlots.push('')
      },
      removeTool: (draft, index) => {
        const count = draft.form.callableTools.length
        if (index < 0 || index >= count) return
        draft.form.callableTools.splice(index, 1)
        draft.form.toolSlots.splice(index, 1)
      },
      toggleSection: (draft, id) => {
        const at = draft.collapsed.indexOf(id)
        if (at >= 0) draft.collapsed.splice(at, 1)
        else draft.collapsed.push(id)
      },
      setAppliedTemplate: (draft, id) => { draft.appliedTemplate = id },
      reset: (draft) => {
        draft.form = createEmptyForm()
        // 清空是「回到空白」：套用标记必须一起走，否则界面会继续声称表单来自某套模板。
        draft.appliedTemplate = ''
      },
    },
  })
}
