/**
 * 逐条编辑控件：数组字段的增、删、改、上下移序。
 *
 * 数组字段的形状由 `ListFieldMeta` 描述，本控件不认识字段语义。
 *
 * 样式在 CSS Modules 里（`shared/ui/panel.module.css`）。
 */
import type { ReactNode } from 'react'
import type { ListFieldMeta } from '../../shared/types.js'
import { Field, SmallButton, TextInput } from '../../../../shared/ui/base.js'
import type { FormActions } from '../actions.js'
import s from '../../../../shared/ui/panel.module.css'

/** 逐条编辑控件的 props。 */
export interface ListEditorProps {
  /** 字段元数据（标签与占位符）。 */
  field: ListFieldMeta
  /** 当前条目。 */
  items: readonly string[]
  /** store 动作。 */
  actions: FormActions
}

/**
 * 逐条编辑控件。
 * @param props - 字段元数据、条目与动作。
 * @returns 编辑器元素。
 */
export function ListEditor({ field, items, actions }: ListEditorProps): ReactNode {
  return (
    <Field label={field.label}>
      <div className={s.listColumn}>
        {items.map((item, index) => (
          <div key={`item-${index}`} className={s.row}>
            <TextInput
              value={item}
              ariaLabel={`${field.label} 第 ${index + 1} 条`}
              placeholder={field.placeholder}
              onChange={value => actions.setItem(field.key, index, value)}
            />
            <SmallButton
              title="上移"
              disabled={index === 0}
              onClick={() => actions.moveItem(field.key, index, -1)}
            >
              ↑
            </SmallButton>
            <SmallButton
              title="下移"
              disabled={index === items.length - 1}
              onClick={() => actions.moveItem(field.key, index, 1)}
            >
              ↓
            </SmallButton>
            <SmallButton title="删除这一条" onClick={() => actions.removeItem(field.key, index)}>
              ×
            </SmallButton>
          </div>
        ))}
        <SmallButton
          title="添加一条"
          className={s.listAdd}
          onClick={() => actions.addItem(field.key, '')}
        >
          + 添加一条
        </SmallButton>
      </div>
    </Field>
  )
}
