/**
 * 结构化输入任务插件 —— DSH 浏览器半边。
 *
 * 两个槽位注册，共用同一个 `store` 句柄：
 *  - `conversation.input.left`（list）—— 输入框底部工具栏里的入口按钮。
 *  - `conversation.input.dock`（list）—— 开启时渲染表单弹窗，关闭时不占空间。
 *
 * 两个注册**都必须声明 `store` 座位**：`useStore`/`actions` 不是标准 props，
 * 而是渲染器在 `host.storeOf(entry)` 有值时才注入的。漏声明会让组件拿到
 * `undefined`、渲染时抛错，条目随即被隔离失效（按钮就"消失"了）。注册表因此
 * 抽成 {@link slotEntries}，便于离线测试校验这条契约。
 *
 * 本插件不读取任何主机数据：手动工具策略由用户直接填写工具名，不再从"已安装
 * 清单"里勾选 —— DSH 的插件清单列的是自带插件而非用户安装的插件，skills 清单
 * 也不属于本插件的职责；工具检索在输入框的 `/` 菜单里。因此这里不需要
 * `remote`，也不需要任何 RPC。
 *
 * 表单弹窗挂在 `input.dock`，而不是接管输入框的两个候选：
 *  - `conversation.composer`（chain）：`select` 是纯函数，只在槽位重渲染时重新
 *    执行；store 更新不会触发槽位重渲染（只有 session 源/props 变化才会），所以
 *    链入口无法在用户点击后自行接管。
 *  - `conversation.composer.bar`（single）：遮蔽是静态的，同一 cell 只有最低
 *    优先级者渲染，无法"仅在开启时"接管。
 */
import { createStructuredInputStore } from './store.js'
import { StructuredInputPanel, StructuredInputTrigger, PANEL_CSS } from './Form.js'

/** 只需要槽位注册。 */
export const inject = ['slots']

/**
 * 本插件的槽位注册表：`[槽位名, 注册选项, 组件]`。
 *
 * 两个注册共享同一个 store 句柄，渲染器按「handle × sessionId」共享实例，因此
 * 入口的 `open()` 会直接驱动弹窗组件重渲染，不需要跨注册的状态同步。
 * @param store - `createStructuredInputStore()` 的句柄。
 * @returns 注册三元组列表。
 */
export function slotEntries(store) {
  return [
    [
      'conversation.input.left',
      { name: 'conversation.input.left', id: 'structured-prompt', order: 20, store },
      StructuredInputTrigger,
    ],
    [
      'conversation.input.dock',
      { name: 'conversation.input.dock', id: 'structured-prompt', order: 10, store },
      StructuredInputPanel,
    ],
  ]
}

/**
 * 客户端插件主体。
 * @param ctx - Web Client 根上下文。
 */
export function apply(ctx) {
  const store = createStructuredInputStore()

  // 内联样式覆盖不到的伪类与滚动条：按 DSH 客户端插件惯例注入带标记的 style
  // 标签，重复加载时不会叠加。
  ctx.effect(() => {
    const selector = 'style[data-plugin-css="dsh-plugin-structured-prompt"]'
    if (document.querySelector(selector) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-plugin-structured-prompt'
      tag.dataset.pluginCss = 'dsh-plugin-structured-prompt'
      tag.textContent = PANEL_CSS
      document.head.appendChild(tag)
    }
    return () => {
      const tag = document.querySelector(selector)
      if (tag !== null) tag.remove()
    }
  }, 'structured-prompt: styles')

  for (const [slotName, options, component] of slotEntries(store)) {
    ctx.slots.inject(slotName, () => ctx.slots.register(options, component))
  }
}
