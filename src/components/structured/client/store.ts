/**
 * 结构化提示词组件的会话状态（client 半边）。
 *
 * 两个槽位注册共用**本组件自己的** store 句柄：入口按钮（`conversation.input.left`）切换开关，
 * 弹窗（`conversation.input.dock`）按开关渲染。实例由 Slot 渲染器按「handle × sessionId」缓存，
 * 因此两处共享同一实例，不需要跨注册的状态同步。提示词库有它自己的 store（见
 * `components/library/client/store.ts`），两者不再共用一个状态树。
 *
 * 工具名与用途**按索引配对**（`callableTools[i]` ↔ `toolSlots[i]`），所以增删必须
 * 成对操作；`addTool` / `removeTool` 是唯一的成对入口，避免两个数组长度错位。
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { StoreHandle } from '@deepseek-ai/dsh-client-store'
import type { AssistState, ListFieldKey, PromptForm, StructuredState } from '../shared/types.js'
import { completeForm, createEmptyForm } from '../shared/forms.js'

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
    assist: { brief: '', status: 'idle', error: '', warnings: [] },
  }
}

/** store 的动作表：`draft` 之外的参数会原样暴露给组件。 */
export interface StructuredActions {
  /** 打开表单弹窗。 */
  open(draft: StructuredState): void
  /** 关闭表单弹窗（表单内容保留，便于再次进入）。 */
  close(draft: StructuredState): void
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
  /** 改写自动填充的那句话需求。 */
  setAssistBrief(draft: StructuredState, brief: string): void
  /** 局部更新自动填充的状态（开始 / 结果 / 失败都经它落下）。 */
  patchAssist(draft: StructuredState, patch: Partial<AssistState>): void
  /** 清空表单，回到空白状态。 */
  reset(draft: StructuredState): void
}

/** 本组件 store 的句柄类型。 */
export type StructuredInputStore = StoreHandle<StructuredState, StructuredActions>

/**
 * 声明结构化提示词的 store。
 * @returns store 句柄，写集覆盖整表替换、字段写入、数组条目增删改序与分组折叠。
 */
export function createStructuredInputStore(): StructuredInputStore {
  return defineStore<StructuredState, StructuredActions>({
    init: emptyState,
    actions: {
      open: (draft) => { draft.active = true },
      close: (draft) => { draft.active = false },
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
      setAssistBrief: (draft, brief) => { draft.assist.brief = brief },
      patchAssist: (draft, patch) => { Object.assign(draft.assist, patch) },
      reset: (draft) => {
        draft.form = createEmptyForm()
        // 清空是「回到空白」：套用标记必须一起走，否则界面会继续声称表单来自某套模板。
        draft.appliedTemplate = ''
      },
    },
  })
}
