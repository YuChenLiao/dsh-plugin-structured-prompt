/**
 * 表单基础控件：文本域、单行输入、字段块、按钮。
 *
 * 这些控件不知道表单字段的语义 —— 它们只接收值、变更回调与无障碍名，字段映射
 * 由 `sections/` 下的分组组件负责。
 */
import type { CSSProperties, ReactNode } from 'react'
import {
  COLORS,
  TEXTAREA_MAX_PX,
  TEXTAREA_MIN_PX,
  buttonStyle,
  inputStyle,
  labelStyle,
  rowStyle,
  requiredMarkStyle,
} from './styles.js'

/**
 * 浏览器是否支持 `field-sizing: content`（文本域按内容自适应高度）。
 * 支持的浏览器不需要 JS 参与；不支持的由 `fitTextArea` 兜底。
 *
 * 只探测一次并缓存：结果在整个页面生命周期内不变。
 */
function supportsContentSizing(): boolean {
  if (typeof document === 'undefined') return false
  const probe = document.createElement('textarea')
  probe.style.fieldSizing = 'content'
  return probe.style.fieldSizing === 'content'
}

let contentSizing: boolean | undefined

/**
 * JS 兜底：把文本域高度贴合内容（上限由 {@link TEXTAREA_MAX_PX} 约束）。
 * @param element - 文本域元素。
 */
function fitTextArea(element: HTMLTextAreaElement | null): void {
  if (element === null || contentSizing === true) return
  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, TEXTAREA_MAX_PX)}px`
}

/** 多行文本域的 props。 */
export interface TextAreaProps {
  /** 当前值。 */
  value: string
  /** 值变更回调。 */
  onChange: (value: string) => void
  /** 占位符。 */
  placeholder: string
  /** 无障碍名。 */
  ariaLabel: string
}

/**
 * 多行文本域：高度随内容自适应，所以每条表单项都能完整展示，不会被限高。
 * @param props - 值、变更回调、占位符与无障碍名。
 * @returns 文本域元素。
 */
export function TextArea({ value, onChange, placeholder, ariaLabel }: TextAreaProps): ReactNode {
  contentSizing ??= supportsContentSizing()
  const style: CSSProperties = {
    ...inputStyle,
    minHeight: TEXTAREA_MIN_PX,
    maxHeight: TEXTAREA_MAX_PX,
    // 支持的浏览器走 CSS 自适应；不支持的由首挂载与 onChange 时的 JS 兜底。
    ...(contentSizing ? { fieldSizing: 'content' } : {}),
  }
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      style={style}
      ref={(element) => { if (!contentSizing) fitTextArea(element) }}
      onChange={(event) => {
        if (!contentSizing) fitTextArea(event.currentTarget)
        onChange(event.target.value)
      }}
    />
  )
}

/** 单行输入的 props。 */
export interface TextInputProps {
  /** 当前值。 */
  value: string
  /** 值变更回调。 */
  onChange: (value: string) => void
  /** 占位符。 */
  placeholder: string
  /** 无障碍名。 */
  ariaLabel: string
}

/**
 * 单行输入。
 * @param props - 值、变更回调、占位符与无障碍名。
 * @returns 输入元素。
 */
export function TextInput({ value, onChange, placeholder, ariaLabel }: TextInputProps): ReactNode {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      style={{ ...inputStyle, resize: undefined }}
      onChange={event => onChange(event.target.value)}
    />
  )
}

/** 字段块的 props。 */
export interface FieldProps {
  /** 字段标签。 */
  label: string
  /** 是否必填（渲染星号）。 */
  required?: boolean
  /** 控件本体。 */
  children: ReactNode
}

/**
 * 带标题的字段块。
 * @param props - 标签、必填标记与控件。
 * @returns 字段块元素。
 */
export function Field({ label, required, children }: FieldProps): ReactNode {
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {required === true ? <span style={requiredMarkStyle}>*</span> : null}
      </label>
      {children}
    </div>
  )
}

/** 次要按钮的 props。 */
export interface SmallButtonProps {
  /** 点击回调。 */
  onClick: () => void
  /** 提示文本（同时作为无障碍名的兜底）。 */
  title: string
  /** 按钮文字。 */
  children: ReactNode
  /** 无障碍名；缺省时用 `title`。 */
  ariaLabel?: string
  /** 是否禁用。 */
  disabled?: boolean
  /** 额外样式。 */
  style?: CSSProperties
}

/**
 * 次要按钮：统一 `type="button"` 与禁用态，避免各处重复写。
 * @param props - 回调、提示与文字。
 * @returns 按钮元素。
 */
export function SmallButton({
  onClick, title, children, ariaLabel, disabled, style,
}: SmallButtonProps): ReactNode {
  return (
    <button
      type="button"
      style={{ ...buttonStyle, ...style }}
      title={title}
      aria-label={ariaLabel ?? title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** 一组互斥 chip 的 props。 */
export interface ChipGroupProps {
  /** 选项：`[值, 显示文字]`。 */
  options: readonly (readonly [string, string])[]
  /** 当前选中的值。 */
  value: string
  /** 选择回调。 */
  onPick: (value: string) => void
}

/**
 * 互斥选项组（chip 形式）：用于策略与输出格式这类少量枚举。
 * @param props - 选项、当前值与回调。
 * @returns chip 组元素。
 */
export function ChipGroup({ options, value, onPick }: ChipGroupProps): ReactNode {
  return (
    <div style={{ ...rowStyle, flexWrap: 'wrap' }}>
      {options.map(([optionValue, text]) => (
        <button
          key={optionValue === '' ? 'none' : optionValue}
          type="button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            border: `1px solid ${value === optionValue ? COLORS.accent : COLORS.border}`,
            borderRadius: 999,
            background: value === optionValue ? COLORS.accentSoft : 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontSize: 12,
            cursor: 'pointer',
          }}
          aria-pressed={value === optionValue}
          onClick={() => onPick(optionValue)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
