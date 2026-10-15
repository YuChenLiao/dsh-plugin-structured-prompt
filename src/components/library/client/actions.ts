/**
 * 提示词库组件的组件侧动作类型。
 *
 * 独立成文件是为了打断循环引用（与结构化组件同一套做法）：界面组件需要动作、而动作类型推导自
 * store。类型层没有运行时依赖，独立声明最省事。
 */
import type { BakedActions } from '@deepseek-ai/dsh-client-store'
import type { LibraryComponentActionsDecl } from './store.js'

/** store 动作表在组件侧的形态：`draft` 已由框架绑定，组件只看到业务参数。 */
export type LibraryComponentActions = BakedActions<LibraryComponentActionsDecl>
