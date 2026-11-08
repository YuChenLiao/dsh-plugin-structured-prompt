/**
 * 右侧栏 tab 里的表单：与弹窗**同一份** `FormPanel`，只是外壳由宿主提供。
 *
 * 与弹窗的差别只有三点，都不需要这里写测量代码：
 *  - 没有遮罩、没有尺寸：宿主给多少地方就占多少（`.panel` 负责纵向撑开）；
 *  - 没有关闭按钮：侧栏 tab 自带关闭手势，标题栏再放一个 × 只是重复；
 *  - 不读 `active`：tab 存在即"已打开"，打开/关闭由侧栏的 tab 记录负责。
 *
 * 发送与扩写走宿主注入的 `send` / 会话标识，与弹窗同一条链路（`src/shared/send.ts`）。
 * 「库 → 表单」的交接仍然由弹窗容器持有：它挂在输入区、始终挂载，tab 打开时也在，
 * 这样补丁只有一处订阅者。
 */
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { StructuredState } from '../../shared/types.js'
import type { FormActions } from '../actions.js'
import { findTemplate } from '../../shared/templates.js'
import { FormPanel } from './FormPanel.js'
import { useAssistRunner } from './panel-hooks.js'

/** tab 主体的 props。 */
export interface StructuredSidebarFormProps {
  /** store 的读座位。 */
  useStore: SnapshotSelectorHook<StructuredState>
  /** store 的写座位。 */
  actions: FormActions
  /** 把文本发进指定会话（由注册的 `inject` 面提供）。 */
  send: (sessionId: string, prompt: string) => void
  /** 会话标识（会话作用域槽位的标准 props）；无会话时不渲染。 */
  sessionId?: string | undefined
}

/**
 * tab 主体。
 * @param props - store 座位、发送链路与会话标识。
 * @returns 表单本体，或没有会话时的 `null`。
 */
export function StructuredSidebarForm({
  useStore, actions, send, sessionId,
}: StructuredSidebarFormProps): ReactNode {
  const form = useStore(state => state.form)
  const collapsed = useStore(state => state.collapsed)
  const appliedTemplate = useStore(state => state.appliedTemplate)
  const assist = useStore(state => state.assist)
  // id → 模板的解析在数据层做，界面组件只收结果（与弹窗一致）。
  const applied = findTemplate(appliedTemplate)
  const runAssist = useAssistRunner({ form, assist, actions, sessionId })

  if (sessionId === undefined) return null

  return (
    <FormPanel
      form={form}
      collapsed={collapsed}
      applied={applied}
      actions={actions}
      onSend={(prompt) => { send(sessionId, prompt) }}
      assist={assist}
      onBriefChange={(brief) => { actions.setAssistBrief(brief) }}
      onAssist={runAssist}
      // 刻意**不传** `onClose`：关闭手势属于 tab，标题栏就不画 ×。
      // （`FormPanel` 的默认值是"有 onClose 才画"，所以这行不需要 `showClose={false}` ——
      //  那会是一行删掉也不改变行为的死代码，测试也钉不住。）
    />
  )
}
