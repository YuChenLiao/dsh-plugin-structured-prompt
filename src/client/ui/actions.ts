/**
 * 表单组件的共享 props 形状。
 *
 * 独立成文件是为了打断循环引用：逐条编辑器（`ListEditor` / `ToolPairEditor`）需要表单动作，
 * 而 `sections/*` 既需要动作也需要编辑器。类型层没有运行时依赖，独立声明最省事。
 */
import type { BakedActions } from '@deepseek-ai/dsh-client-store'
import type { StructuredActions } from '../store.js'

/**
 * store 动作表在组件侧的形态：`draft` 已由框架绑定，组件只看到业务参数。
 *
 * 从 store 的动作表推导，而不是重写一遍签名 —— 新增动作时组件侧自动获得类型。
 */
export type FormActions = BakedActions<StructuredActions>
