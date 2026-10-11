/**
 * 主题常量：颜色 token 与文本域尺寸。
 *
 * 与 `styles.ts`（组件样式对象）分开，是为了让「视觉取值」与「样式结构」各自有
 * 单一归属 —— 换主题只动这里，调布局只动 `styles.ts`。
 */
import type { CSSProperties } from 'react'

/** 主题 token（均带回退值，token 缺失时仍可读）。 */
export const COLORS = {
  // 弹窗是 raised 表面；遮罩沿用 DSH Modal 原语的两个 token。
  surface: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  mask: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.24))',
  maskBlur: 'var(--dsw-mask-blur, blur(2px))',
  // 弹窗是最高层表面，用 elevation 阶里最明显的一档。
  shadow: 'var(--dsw-elevation-prominent, 0 4px 16px rgba(0,0,0,0.12))',
  text: 'var(--dsw-alias-label-primary, inherit)',
  textSecondary: 'var(--dsw-alias-label-secondary, rgba(128,128,128,0.95))',
  caption: 'var(--dsw-alias-label-caption, rgba(128,128,128,0.85))',
  border: 'var(--dsw-alias-border-l2, rgba(128,128,128,0.22))',
  borderStrong: 'var(--dsw-alias-border-l3, rgba(128,128,128,0.34))',
  accent: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
  accentSoft: 'var(--dsw-alias-state-business-tertiary, rgba(77,107,254,0.14))',
  danger: 'var(--dsw-alias-state-error-primary, #e5484d)',
  /** 返回确认条的极淡底色（分组不用卡片，这里仍需要一点填充做区分）。 */
  subtle: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.05))',
} as const

/** 文本域行高（px）：fontSize 13 × lineHeight 1.55 ≈ 20，用于自适应高度换算。 */
export const LINE_PX = 20
/** 自适应高度下限：约两行，避免空字段显得过窄。 */
export const TEXTAREA_MIN_PX = LINE_PX * 2 + 18
/** 自适应高度上限：单个字段约 16 行，再长就在文本域内部滚动。 */
export const TEXTAREA_MAX_PX = LINE_PX * 16 + 18

/** 输入框底部工具栏里的入口按钮（与计划/权限控件同一行）。 */
export const triggerButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 24,
  padding: '0 8px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  background: 'transparent',
  color: COLORS.textSecondary,
  font: 'inherit',
  fontSize: 12,
  lineHeight: 1,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
