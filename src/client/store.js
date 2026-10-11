/**
 * 结构化输入任务的共享状态。
 *
 * 两个槽位入口共用同一个 store 句柄：输入框工具栏的入口按钮
 * （`conversation.input.left`）负责切换开关，composer 链入口
 * （`conversation.composer`）负责在开启时接管整张输入卡渲染表单。实例由
 * Slot 渲染器按「handle × sessionId」缓存，因此 `select` 能在渲染前读到
 * 本次会话的实时开关状态，表单内容也随会话隔离并在重新挂载后保留。
 *
 * 表单字段与渲染关系：
 *  - 全部 18 个字段构成 `PromptForm`，其中 `role`/`goal` 必填。
 *  - `toolPolicy` 为 `'auto'` 时由模型自行判断工具，`'manual'` 时用
 *    `selectedSkills` / `selectedPlugins` 指定能力。
 *  - 数组字段 `rules`/`forbidden`/`toolGuidance`/`fields` 逐条增删改序。
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'

/**
 * 空白表单：所有数组为空、所有文本为空，保证「未填写」与「空串」一致。
 * @returns 全新的空白表单对象。
 */
export function emptyForm() {
  return {
    role: '',
    goal: '',
    background: '',
    successCriteria: '',
    rules: [],
    forbidden: [],
    toolPolicy: '',
    /**
     * 手动策略下由用户直接填写的可调用工具名。
     *
     * 这里刻意不提供「从已安装清单里勾选」：DSH 的插件清单列的是自带插件而非
     * 用户安装的插件，skills 清单也不属于本插件的职责；工具检索在输入框的 `/`
     * 菜单里，表单只需要把用户点名的工具写进提示词。
     */
    callableTools: [],
    /** 与 `callableTools` 一一对应的用途说明（可为空串）。 */
    toolSlots: [],
    toolGuidance: [],
    toolFailure: '',
    outputSpec: '',
    outputFormat: '',
    languageTone: '',
    fields: [],
    fallback: '',
    examples: '',
  }
}

/**
 * 空白会话状态。
 * @returns 全新的初始状态。
 */
function emptyState() {
  return {
    active: false,
    form: emptyForm(),
    /**
     * 已折叠的分组 id。默认只展开「基础信息」，其余三组折叠，避免表单一打开
     * 就占满屏幕；用户展开哪一组只看那一组。
     */
    collapsed: ['rules', 'tools', 'output'],
  }
}

/**
 * 声明结构化输入任务的 store。
 * @returns store 句柄，写集覆盖整表替换、字段写入、数组条目增删改序与分组折叠。
 */
export function createStructuredInputStore() {
  return defineStore({
    init: emptyState,
    actions: {
      /** 打开结构化表单模式。 */
      open: (draft) => { draft.active = true },
      /** 关闭并回到输入框模式（表单内容保留，便于再次进入）。 */
      close: (draft) => { draft.active = false },
      /**
       * 整表替换（模板一键填充 / JSON 导入）。
       * @param draft - store 草稿。
       * @param form - 完整表单对象。
       */
      setForm: (draft, form) => { draft.form = { ...emptyForm(), ...form } },
      /**
       * 写入单个字段。
       * @param draft - store 草稿。
       * @param key - 字段名。
       * @param value - 字段值。
       */
      setField: (draft, key, value) => { draft.form[key] = value },
      /**
       * 数组字段追加一条。
       * @param draft - store 草稿。
       * @param key - 数组字段名。
       * @param value - 新条目内容。
       */
      addItem: (draft, key, value) => { draft.form[key].push(value) },
      /**
       * 数组字段改写第 index 条。
       * @param draft - store 草稿。
       * @param key - 数组字段名。
       * @param index - 目标下标。
       * @param value - 新内容。
       */
      setItem: (draft, key, index, value) => {
        if (index < 0 || index >= draft.form[key].length) return
        draft.form[key][index] = value
      },
      /**
       * 数组字段删除第 index 条。
       * @param draft - store 草稿。
       * @param key - 数组字段名。
       * @param index - 目标下标。
       */
      removeItem: (draft, key, index) => {
        if (index < 0 || index >= draft.form[key].length) return
        draft.form[key].splice(index, 1)
      },
      /**
       * 数组字段上下移动（delta 为 -1 或 1）。
       * @param draft - store 草稿。
       * @param key - 数组字段名。
       * @param index - 当前下标。
       * @param delta - 位移量。
       */
      moveItem: (draft, key, index, delta) => {
        const items = draft.form[key]
        const next = index + delta
        if (index < 0 || index >= items.length || next < 0 || next >= items.length) return
        const moved = items.splice(index, 1)[0]
        items.splice(next, 0, moved)
      },
      /**
       * 切换分组折叠状态。
       * @param draft - store 草稿。
       * @param id - 分组 id。
       */
      toggleSection: (draft, id) => {
        const at = draft.collapsed.indexOf(id)
        if (at >= 0) draft.collapsed.splice(at, 1)
        else draft.collapsed.push(id)
      },
      /** 清空表单，回到空白状态。 */
      reset: (draft) => { draft.form = emptyForm() },
    },
  })
}
