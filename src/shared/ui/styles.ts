/**
 * 组件样式对象。
 *
 * 三条布局不变量在这里落地，并由离线测试直接断言（它们各自对应一次真实的 UI
 * 事故）：
 *  1. {@link sectionStyle} 不裁剪：分组曾用卡片包裹，`overflow: hidden` 把需要更多
 *     高度的字段裁掉；
 *  2. {@link sectionStyle} 不压缩：分组上写 `min-height: 0` 会把它压到内容高度以下，
 *     子元素互相压叠；
 *  3. {@link modalBodyStyle} 是唯一滚动容器：`flex: 1 1 auto` + `minHeight: 0` 才能
 *     在弹窗内收缩，溢出的内容出右侧滚动条而不是被裁掉。
 */
import type { CSSProperties } from 'react'
import { COLORS } from './theme.js'

// 主题常量从这里再导出一次，兼容既有的 `./styles.js` import 路径。
export { COLORS, LINE_PX, TEXTAREA_MAX_PX, TEXTAREA_MIN_PX, triggerButtonStyle } from './theme.js'

/** 弹窗遮罩：不绑定点击关闭（见 `Modal.tsx` 的说明）。 */
export const maskStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  boxSizing: 'border-box',
  background: COLORS.mask,
  // 与 DSH Modal 原语一致的遮罩处理。
  backdropFilter: COLORS.maskBlur,
}

/** 弹窗本体：固定宽度、高度由内容决定、最多占窗口 70%。 */
export const modalStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 'clamp(600px, 74vw, 900px)',
  maxWidth: '100%',
  maxHeight: '70vh',
  border: 0,
  borderRadius: 16,
  background: COLORS.surface,
  boxShadow: COLORS.shadow,
  color: COLORS.text,
  fontSize: 13,
  overflow: 'hidden',
}

/** 标题栏：标题 + 必填提示 + 右上角关闭。 */
export const modalHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  flex: 'none',
  padding: '12px 16px',
  borderBottom: `1px solid ${COLORS.border}`,
}

/** 弹窗内容区 —— 唯一的滚动容器（见文件头第 3 条不变量）。 */
export const modalBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  padding: '16px 18px',
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  // 滚动条常驻槽位，避免内容增减时表单左右跳动。
  scrollbarGutter: 'stable',
}

/** 底部操作栏：放弃类操作在左，确认类操作在右。 */
export const modalFootStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
  flex: 'none',
  padding: '12px 16px',
  borderTop: `1px solid ${COLORS.border}`,
}

/** 分组容器（见文件头第 1、2 条不变量）。 */
export const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

/** 分组标题：一条可点击的标题行，用底线作分隔。 */
export const sectionHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  gap: 8,
  padding: '0 0 8px',
  border: 0,
  borderBottom: `1px solid ${COLORS.border}`,
  background: 'transparent',
  color: COLORS.textSecondary,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.02em',
  cursor: 'pointer',
  textAlign: 'left',
}

/** 分组内容区。 */
export const sectionBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}

/** 字段标签。 */
export const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: 5,
  fontSize: 12,
  color: COLORS.textSecondary,
}

/** 必填星号。 */
export const requiredMarkStyle: CSSProperties = { color: COLORS.danger, marginLeft: 3 }

/** 输入控件通用样式（文本域在此之上加自适应高度）。 */
export const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 9px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.55,
  resize: 'vertical',
}

/** 横向排列一行（按钮组、输入 + 操作）。 */
export const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 }

/** 次要按钮。 */
export const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 26,
  height: 26,
  padding: '0 8px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

/** 主按钮（确认类操作）。 */
export const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  padding: '0 14px',
  height: 30,
  border: 0,
  background: COLORS.accent,
  color: 'var(--dsw-alias-label-primary-foreground, #fff)',
  fontWeight: 600,
}

/**
 * 供注入的样式：内联样式无法覆盖的伪类与滚动条。
 *
 * 由 `src/client/index.ts` 以带标记的 `<style>` 标签注入一次（重复加载不叠加）。
 */
export const PANEL_CSS = `
[data-dsh-prompt-trigger]:hover {
  border-color: ${COLORS.borderStrong};
  color: ${COLORS.text};
}
[data-dsh-prompt-panel] textarea,
[data-dsh-prompt-panel] input,
[data-dsh-prompt-panel] select {
  outline: none;
}
[data-dsh-prompt-panel] textarea:focus,
[data-dsh-prompt-panel] input:focus,
[data-dsh-prompt-panel] select:focus {
  border-color: ${COLORS.accent};
}
[data-dsh-prompt-panel] textarea::placeholder,
[data-dsh-prompt-panel] input::placeholder {
  color: ${COLORS.caption};
}
[data-dsh-prompt-panel] button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 弹窗内容区的右侧滚动条：细、无轨道、跟随主题。 */
[data-dsh-prompt-panel] [data-scroll] {
  scrollbar-width: thin;
  scrollbar-color: ${COLORS.borderStrong} transparent;
}
[data-dsh-prompt-panel] [data-scroll]::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
[data-dsh-prompt-panel] [data-scroll]::-webkit-scrollbar-track {
  background: transparent;
}
[data-dsh-prompt-panel] [data-scroll]::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
  background-color: ${COLORS.borderStrong};
}
[data-dsh-prompt-panel] [data-scroll]::-webkit-scrollbar-thumb:hover {
  background-color: ${COLORS.caption};
}
`