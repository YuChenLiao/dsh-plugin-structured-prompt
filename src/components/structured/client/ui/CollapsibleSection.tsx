/**
 * 可折叠分组容器：标题行 + 内容。
 *
 * 折叠状态由 store 持有（`collapsed` 数组），所以展开/收起在会话内保留。基础信息
 * 组的 `collapsible` 为 `false`，标题行退化为不可点击的分隔线。
 */
import type { ReactNode } from 'react'
import type { SectionMeta } from '../../shared/types.js'
import { COLORS, sectionBodyStyle, sectionHeadStyle, sectionStyle } from '../../../../shared/ui/styles.js'

/** 可折叠分组的 props。 */
export interface CollapsibleSectionProps {
  /** 分组元数据。 */
  meta: SectionMeta
  /** 是否处于折叠状态。 */
  collapsed: boolean
  /** 切换折叠。 */
  onToggle: () => void
  /** 分组内容。 */
  children: ReactNode
}

/**
 * 一个分组。
 * @param props - 元数据、折叠状态与内容。
 * @returns 分组元素。
 */
export function CollapsibleSection({
  meta, collapsed, onToggle, children,
}: CollapsibleSectionProps): ReactNode {
  const open = meta.collapsible !== true || !collapsed
  return (
    <div style={sectionStyle}>
      <button
        type="button"
        style={sectionHeadStyle}
        aria-expanded={open}
        onClick={() => { if (meta.collapsible === true) onToggle() }}
      >
        <span>{meta.title}</span>
        {meta.collapsible === true
          ? <span style={{ color: COLORS.caption }}>{open ? '▾' : '▸'}</span>
          : null}
      </button>
      {open ? <div style={sectionBodyStyle}>{children}</div> : null}
    </div>
  )
}
