/**
 * 手动策略的工具编辑：工具名与用途**按索引配对**增删。
 *
 * 刻意不做"从已安装清单里勾选"—— DSH 的插件清单列的是自带插件而非用户安装的
 * 插件，skills 清单也不属于本插件的职责；工具检索在输入框的 `/` 菜单里。表单只
 * 负责把用户点名的工具按序写进提示词。
 *
 * 增删都经由 store 的 `addTool` / `removeTool`，保证两个数组长度始终一致。
 */
import type { ReactNode } from 'react'
import type { PromptForm } from '../../shared/types.js'
import { Field, SmallButton, TextInput } from '../../../../shared/ui/base.js'
import type { FormActions } from '../actions.js'
import { COLORS, rowStyle } from '../../../../shared/ui/styles.js'

/** 工具配对编辑器的 props。 */
export interface ToolPairEditorProps {
  /** 表单（读取 `callableTools` 与 `toolSlots`）。 */
  form: PromptForm
  /** store 动作。 */
  actions: FormActions
}

/**
 * 工具配对编辑器。
 * @param props - 表单与动作。
 * @returns 配对编辑控件。
 */
export function ToolPairEditor({ form, actions }: ToolPairEditorProps): ReactNode {
  const names = form.callableTools
  const slots = form.toolSlots
  return (
    <Field label="可调用的工具（工具名 + 用途）">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {names.map((name, index) => (
          <div key={`tool-${index}`} style={rowStyle}>
            <TextInput
              value={name}
              ariaLabel={`第 ${index + 1} 个工具名`}
              placeholder="工具名，例如 query_metrics"
              onChange={value => actions.setItem('callableTools', index, value)}
            />
            <TextInput
              value={slots[index] ?? ''}
              ariaLabel={`第 ${index + 1} 个工具的用途`}
              placeholder="用途（可留空）"
              onChange={value => actions.setItem('toolSlots', index, value)}
            />
            <SmallButton title="删除这一行" onClick={() => actions.removeTool(index)}>
              ×
            </SmallButton>
          </div>
        ))}
        <SmallButton
          title="添加一个工具"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => actions.addTool()}
        >
          + 添加一个工具
        </SmallButton>
        {names.length === 0
          ? (
            <div style={{ color: COLORS.caption, fontSize: 12 }}>
              尚未点名任何工具。手动策略下模型只被允许调用这里列出的工具。
            </div>
          )
          : null}
      </div>
    </Field>
  )
}
