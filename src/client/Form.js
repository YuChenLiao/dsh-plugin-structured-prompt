/**
 * 结构化输入任务的 UI。
 *
 * 两个导出：
 *  - `StructuredInputTrigger`：`conversation.input.left`——输入框底部工具栏里的入口。
 *  - `StructuredInputPanel`：`conversation.input.dock`——开启时渲染表单弹窗。
 *
 * 弹窗结构：标题栏（标题 + 必填提示）/ 可滚动内容区（四个分组）/ 底部操作栏
 * （模板、导入、导出、清空、返回）。滚轮与滚动条只作用于内容区，标题栏和底部
 * 操作栏常驻可见。
 *
 * 视觉全部走 DSH 主题 token（`--dsw-alias-*` / `--dsw-elevation-*`），深浅色
 * 主题自动跟随。
 */
import { Fragment, createElement, useEffect, useMemo, useRef, useState } from 'react'
import { buildSystemPrompt, validateForm, OUTPUT_FORMAT_SKELETONS, TEMPLATES } from './prompt.js'

/** 主题 token（均带回退值，token 缺失时仍可读）。 */
const C = {
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
}

/** 输入框底部工具栏里的入口按钮（与计划/权限控件同一行）。 */
const triggerButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 24,
  padding: '0 8px',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  background: 'transparent',
  color: C.textSecondary,
  font: 'inherit',
  fontSize: 12,
  lineHeight: 1,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const maskStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  boxSizing: 'border-box',
  background: C.mask,
  // 与 DSH Modal 原语一致的遮罩处理。
  backdropFilter: C.maskBlur,
}

const modalStyle = {
  display: 'flex',
  flexDirection: 'column',
  // 固定宽度；高度完全由内容决定（不占满窗口），只有超过上限才在内容区滚动。
  width: 'clamp(600px, 74vw, 900px)',
  maxWidth: '100%',
  maxHeight: '70vh',
  border: 0,
  borderRadius: 16,
  background: C.surface,
  boxShadow: C.shadow,
  color: C.text,
  fontSize: 13,
  overflow: 'hidden',
}

const modalHeadStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  flex: 'none',
  padding: '12px 16px',
  borderBottom: `1px solid ${C.border}`,
}

/**
 * 弹窗内容区：`flex: 1 1 auto` + `minHeight: 0` 是它能在弹窗内正确收缩、并在
 * 高度溢出时于**右侧**出现滚动条的关键；没有这两项，内容会被父级的
 * `overflow: hidden` 直接裁掉（那正是字段看起来"被隐藏"的原因）。
 *
 * 导出是为了让离线测试直接断言滚动条的挂载点与收缩行为。
 */
export const modalBodyStyle = {
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
const modalFootStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
  flex: 'none',
  padding: '12px 16px',
  borderTop: `1px solid ${C.border}`,
}

/**
 * 分组不用卡片包裹：卡片会带来 `overflow: hidden`，一旦内层需要更多高度就会
 * 被裁掉，而且会截断外层的滚动。改为纯标题 + 分隔线，内容自然展开，溢出由弹窗
 * 内容区的滚动条统一处理。
 *
 * 导出是为了让离线测试直接断言"任何层级都不裁剪内容"这条不变量。
 */
export const sectionStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  // 故意不写 min-height：默认的 `min-height: auto` 让分组按内容撑高。
  // 若在这里写 `min-height: 0`，分组会被压缩到内容高度以下、子元素互相压叠。
  // `min-height: 0` 只属于上面那个真正需要收缩的滚动容器。
}

/** 分组标题：一条可点击的标题行，用底线作分隔。 */
const sectionHeadStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  gap: 8,
  padding: '0 0 8px',
  border: 0,
  borderBottom: `1px solid ${C.border}`,
  background: 'transparent',
  color: C.textSecondary,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.02em',
  cursor: 'pointer',
  textAlign: 'left',
}

const sectionBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}

const labelStyle = { display: 'block', marginBottom: 5, fontSize: 12, color: C.textSecondary }
const requiredMarkStyle = { color: C.danger, marginLeft: 3 }

/** 文本域行高（px）：fontSize 13 × lineHeight 1.55 ≈ 20，用于自适应高度换算。 */
const LINE_PX = 20
/** 自适应高度下限：约两行，避免空字段显得过窄。 */
const TEXTAREA_MIN_PX = LINE_PX * 2 + 18
/** 自适应高度上限：单个字段约 16 行，再长就在文本域内部滚动。 */
const TEXTAREA_MAX_PX = LINE_PX * 16 + 18

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 9px',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.55,
  resize: 'vertical',
}

const rowStyle = { display: 'flex', alignItems: 'center', gap: 6 }

const buttonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 26,
  height: 26,
  padding: '0 8px',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const primaryButtonStyle = {
  ...buttonStyle,
  padding: '0 14px',
  height: 30,
  border: 0,
  background: C.accent,
  color: 'var(--dsw-alias-label-primary-foreground, #fff)',
  fontWeight: 600,
}

/** 选项 chip：选中时用主题的业务色。 */
const chipStyle = (on) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  border: `1px solid ${on ? C.accent : C.border}`,
  borderRadius: 999,
  background: on ? C.accentSoft : 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
})

/** 分组：基础信息常开，其余三组默认折叠但可展开。 */
const SECTIONS = [
  { id: 'basic', title: '基础信息', collapsible: false },
  { id: 'rules', title: '约束与规则', collapsible: true },
  { id: 'tools', title: '工具策略', collapsible: true },
  { id: 'output', title: '输出与兜底', collapsible: true },
]

/** 逐条编辑的数组字段。 */
const LIST_FIELDS = [
  {
    key: 'rules',
    label: '硬性规则（每行一条，会按 1. 2. 3. 编号）',
    placeholder: '例如：所有数值必须带上单位和时间窗口',
  },
  {
    key: 'forbidden',
    label: '禁止行为（每行一条）',
    placeholder: '例如：不得输出猜测性的根因结论',
  },
  {
    key: 'toolGuidance',
    label: '工具使用策略（每行一条）',
    placeholder: '例如：先调用 query_metrics 拿指标，再调用 get_threshold_config 拿阈值',
  },
  {
    key: 'fields',
    label: '字段级说明（每行一条）',
    placeholder: '例如：severity: "P0" | "P1" | "P2" | "info"',
  },
]

/** 供注入的样式：内联样式无法覆盖的伪类与滚动条。 */
export const PANEL_CSS = `
[data-structured-prompt-trigger]:hover {
  border-color: ${C.borderStrong};
  color: ${C.text};
}
[data-structured-prompt-modal] textarea,
[data-structured-prompt-modal] input,
[data-structured-prompt-modal] select {
  outline: none;
}
[data-structured-prompt-modal] textarea:focus,
[data-structured-prompt-modal] input:focus,
[data-structured-prompt-modal] select:focus {
  border-color: ${C.accent};
}
[data-structured-prompt-modal] textarea::placeholder,
[data-structured-prompt-modal] input::placeholder {
  color: ${C.caption};
}
[data-structured-prompt-modal] button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 弹窗内容区的右侧滚动条：细、无轨道、跟随主题。 */
[data-structured-prompt-modal] [data-scroll] {
  scrollbar-width: thin;
  scrollbar-color: ${C.borderStrong} transparent;
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar,
[data-structured-prompt-list]::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar-track,
[data-structured-prompt-list]::-webkit-scrollbar-track {
  background: transparent;
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar-thumb,
[data-structured-prompt-list]::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
  background-color: ${C.borderStrong};
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar-thumb:hover,
[data-structured-prompt-list]::-webkit-scrollbar-thumb:hover {
  background-color: ${C.caption};
}
`

/**
 * 浏览器是否支持 `field-sizing: content`（文本域按内容自适应高度）。
 * 支持的浏览器不需要 JS 参与；不支持的由 onInput 兜底。
 * @returns 是否支持。
 */
function supportsContentSizing() {
  if (typeof document === 'undefined') return false
  const probe = document.createElement('textarea')
  probe.style.fieldSizing = 'content'
  return probe.style.fieldSizing === 'content'
}

let contentSizing

/**
 * 多行文本域：高度随内容自适应，所以每条表单项都能完整展示，不会被限高。
 * @param props - 值、变更回调、占位符与无障碍名。
 * @returns 文本域元素。
 */
function TextArea({ value, onChange, placeholder, ariaLabel }) {
  if (contentSizing === undefined) contentSizing = supportsContentSizing()
  /** @param {HTMLTextAreaElement | null} element - 文本域。 */
  const fit = (element) => {
    if (element === null || contentSizing === true) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, TEXTAREA_MAX_PX)}px`
  }
  return createElement('textarea', {
    value,
    placeholder,
    'aria-label': ariaLabel,
    style: {
      ...inputStyle,
      minHeight: TEXTAREA_MIN_PX,
      maxHeight: TEXTAREA_MAX_PX,
      // 支持的浏览器走 CSS 自适应；不支持的由 fit() 兜底。
      ...(contentSizing === true ? { fieldSizing: 'content' } : {}),
    },
    ref: element => { if (contentSizing !== true) fit(element) },
    onChange: event => {
      if (contentSizing !== true) fit(event.currentTarget)
      onChange(event.target.value)
    },
  })
}

/** 单行输入。 */
function TextInput({ value, onChange, placeholder, ariaLabel }) {
  return createElement('input', {
    type: 'text',
    value,
    placeholder,
    'aria-label': ariaLabel,
    style: { ...inputStyle, resize: undefined },
    onChange: event => onChange(event.target.value),
  })
}

/** 带标题的字段块。 */
function Field({ label, required, children }) {
  return createElement(
    'div',
    null,
    createElement(
      'label',
      { style: labelStyle },
      label,
      required === true ? createElement('span', { style: requiredMarkStyle }, '*') : null,
    ),
    children,
  )
}

/** 逐条编辑控件（增删改 + 上下移序）。 */
function ListEditor({ field, items, actions }) {
  const list = Array.isArray(items) ? items : []
  return createElement(
    Field,
    { label: field.label },
    createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      ...list.map((item, index) => createElement(
        'div',
        { key: `item-${index}`, style: rowStyle },
        createElement(TextInput, {
          value: item,
          ariaLabel: `${field.label} 第 ${index + 1} 条`,
          placeholder: field.placeholder,
          onChange: value => actions.setItem(field.key, index, value),
        }),
        createElement('button', {
          type: 'button',
          style: buttonStyle,
          title: '上移',
          'aria-label': '上移',
          disabled: index === 0,
          onClick: () => actions.moveItem(field.key, index, -1),
        }, '↑'),
        createElement('button', {
          type: 'button',
          style: buttonStyle,
          title: '下移',
          'aria-label': '下移',
          disabled: index === list.length - 1,
          onClick: () => actions.moveItem(field.key, index, 1),
        }, '↓'),
        createElement('button', {
          type: 'button',
          style: buttonStyle,
          title: '删除这一条',
          'aria-label': '删除这一条',
          onClick: () => actions.removeItem(field.key, index),
        }, '×'),
      )),
      createElement('button', {
        type: 'button',
        style: { ...buttonStyle, alignSelf: 'flex-start' },
        onClick: () => actions.addItem(field.key, ''),
      }, '+ 添加一条'),
    ),
  )
}

/**
 * 手动策略的工具编辑：工具名与用途一一配对增删。
 *
 * 刻意不做「从已安装清单里勾选」—— DSH 的插件清单列的是自带插件而非用户安装
 * 的插件，skills 清单也不属于本插件的职责；工具检索在输入框的 `/` 菜单里，表单
 * 只负责把用户点名的工具按序写进提示词。
 * @param props - 表单与 store 动作。
 * @returns 配对编辑控件。
 */
function ToolPairEditor({ form, actions }) {
  const names = Array.isArray(form.callableTools) ? form.callableTools : []
  const slots = Array.isArray(form.toolSlots) ? form.toolSlots : []
  /** 删除一行：两个数组必须同步删，索引才始终对应。 */
  const remove = index => {
    actions.removeItem('callableTools', index)
    actions.removeItem('toolSlots', index)
  }
  return createElement(
    Field,
    { label: '可调用的工具（工具名 + 用途）' },
    createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      ...names.map((name, index) => createElement(
        'div',
        { key: `tool-${index}`, style: rowStyle },
        createElement(TextInput, {
          value: name,
          ariaLabel: `第 ${index + 1} 个工具名`,
          placeholder: '工具名，例如 query_metrics',
          onChange: value => actions.setItem('callableTools', index, value),
        }),
        createElement(TextInput, {
          value: slots[index] ?? '',
          ariaLabel: `第 ${index + 1} 个工具的用途`,
          placeholder: '用途（可留空）',
          onChange: value => actions.setItem('toolSlots', index, value),
        }),
        createElement('button', {
          type: 'button',
          style: buttonStyle,
          title: '删除这一行',
          'aria-label': '删除这一行',
          onClick: () => remove(index),
        }, '×'),
      )),
      createElement('button', {
        type: 'button',
        style: { ...buttonStyle, alignSelf: 'flex-start' },
        onClick: () => {
          actions.addItem('callableTools', '')
          actions.addItem('toolSlots', '')
        },
      }, '+ 添加一个工具'),
      names.length === 0
        ? createElement('div', { style: { color: C.caption, fontSize: 12 } },
          '尚未点名任何工具。手动策略下模型只被允许调用这里列出的工具；')
        : null,
    ),
  )
}

/**
 * `conversation.input.dock` 的占用者：表单弹窗。
 *
 * 弹窗只在开启时渲染，未开启时返回 null 不占空间（入口按钮由
 * `StructuredInputTrigger` 负责）。遮罩点击**不会**关闭弹窗，避免误触丢失
 * 已填内容；关闭只经由底部「返回输入框」或 Esc。
 *
 * hook 调用必须先于任何提前返回（开关会改变渲染分支，分支后的 hook 会让
 * hook 数量随状态变化而抛错）。
 * @param props - 槽位 props（store 座位、inputActions 与注入的 loadCatalog）。
 * @returns 表单弹窗，或未开启时的 null。
 */
export function StructuredInputPanel(props) {
  const { useStore, actions, inputActions, sessionId } = props
  const active = useStore(state => state.active === true)
  const form = useStore(state => state.form)
  const collapsed = useStore(state => state.collapsed)
  const [returnPrompt, setReturnPrompt] = useState(false)
  const importRef = useRef(null)

  // Esc：关闭弹窗。避免困在表单里。
  useEffect(() => {
    if (active !== true) return undefined
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      actions.close()
      setReturnPrompt(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [active, actions])

  if (active !== true || sessionId === undefined) return null

  const prompt = buildSystemPrompt(form)
  const missing = validateForm(form)
  const canSync = missing.length === 0 && prompt !== ''

  /** 「同步已构建提示词并返回」：先写入编辑器草稿，再关闭弹窗。 */
  const syncAndClose = () => {
    if (!canSync) return
    inputActions.setDraft(prompt)
    actions.close()
    setReturnPrompt(false)
  }

  /** 「不同步直接返回」：编辑器里的原有草稿保持不动。 */
  const closeWithoutSync = () => {
    actions.close()
    setReturnPrompt(false)
  }

  /** 导出当前表单为 JSON，便于在别的会话复用。 */
  const exportForm = () => {
    try {
      const blob = new Blob([JSON.stringify(form, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'structured-prompt-form.json'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('[structured-prompt] 导出表单失败：', error)
    }
  }

  /** 从用户选择的 JSON 文件导入表单。 */
  const importForm = event => {
    const file = event.target.files === null ? undefined : event.target.files[0]
    event.target.value = ''
    if (file === undefined) return
    file.text().then((text) => {
      actions.setForm(JSON.parse(text))
    }).catch((error) => {
      console.error('[structured-prompt] 导入表单失败：', error)
    })
  }

  const section = (id, children) => {
    const meta = SECTIONS.find(item => item.id === id)
    const open = meta.collapsible !== true || !collapsed.includes(id)
    return createElement(
      'div',
      { key: id, style: sectionStyle },
      createElement(
        'button',
        {
          type: 'button',
          style: sectionHeadStyle,
          'aria-expanded': open,
          onClick: () => { if (meta.collapsible === true) actions.toggleSection(id) },
        },
        createElement('span', null, meta.title),
        meta.collapsible === true
          ? createElement('span', { style: { color: C.caption } }, open ? '▾' : '▸')
          : null,
      ),
      open ? createElement('div', { style: sectionBodyStyle }, ...children) : null,
    )
  }

  const listField = key => {
    const meta = LIST_FIELDS.find(item => item.key === key)
    return createElement(ListEditor, { key, field: meta, items: form[key], actions })
  }

  return createElement(
    'div',
    {
      style: maskStyle,
      role: 'presentation',
      // 刻意不绑定点击关闭：点遮罩属于误触高发区，已填内容不该因此丢失。
      // 关闭只经由底部「返回输入框」或 Esc。
    },
    createElement(
      'div',
      {
        'data-structured-prompt-modal': '',
        style: modalStyle,
        role: 'dialog',
        'aria-modal': true,
        'aria-label': '结构化输入任务',
      },

      // 标题栏：标题 + 必填提示 + 右上角关闭；操作按钮都在底部。
      createElement(
        'div',
        { style: modalHeadStyle },
        createElement('div', { style: { ...rowStyle, flex: '1 1 auto', minWidth: 0 } },
          createElement('span', { style: { fontSize: 14, fontWeight: 600 } }, '结构化输入任务'),
          missing.length > 0
            ? createElement('span', { style: { color: C.caption, fontSize: 12 } },
              `还差必填：${missing.join('、')}`)
            : null,
        ),
        createElement('button', {
          type: 'button',
          'data-structured-prompt-close': '',
          style: { ...buttonStyle, minWidth: 28, padding: '0 6px', fontSize: 14, lineHeight: 1 },
          title: '关闭（不改动输入框内容）',
          'aria-label': '关闭',
          onClick: closeWithoutSync,
        }, '×'),
      ),

      // 内容区：高度自适应，超出时在右侧滚动。
      createElement(
        'div',
        { 'data-scroll': '', style: modalBodyStyle },

        // 返回模式二选一
        returnPrompt
          ? createElement(
            'div',
            {
              style: {
                ...rowStyle,
                flexWrap: 'wrap',
                padding: '10px 12px',
                border: `1px solid ${C.borderStrong}`,
                borderRadius: 10,
                background: C.subtle,
              },
            },
            createElement('span', { style: { color: C.textSecondary, fontSize: 12 } },
              '返回前是否把已构建的提示词同步到输入框？'),
            createElement('button', {
              type: 'button',
              style: { ...primaryButtonStyle, opacity: canSync ? 1 : 0.5, cursor: canSync ? 'pointer' : 'not-allowed' },
              disabled: !canSync,
              title: canSync ? '把提示词写入输入框草稿' : '身份与目标为必填',
              onClick: syncAndClose,
            }, '同步并返回'),
            createElement('button', {
              type: 'button',
              style: buttonStyle,
              onClick: closeWithoutSync,
            }, '不同步，直接返回'),
          )
          : null,

        // 第 1 组：基础信息（常开）
        section('basic', [
          createElement(Field, { key: 'role', label: '身份', required: true },
            createElement(TextArea, {
              value: form.role,
              ariaLabel: '身份',
              placeholder: '例如：你是一名负责线上稳定性的 SRE 助手，服务于一个日订单量百万级的电商系统。',
              onChange: value => actions.setField('role', value),
            })),
          createElement(Field, { key: 'goal', label: '目标', required: true },
            createElement(TextArea, {
              value: form.goal,
              ariaLabel: '目标',
              placeholder: '例如：根据监控数据判断告警是否需要人工立即介入，并给出首要排查方向。',
              onChange: value => actions.setField('goal', value),
            })),
          createElement(Field, { key: 'background', label: '背景与上下文' },
            createElement(TextArea, {
              value: form.background,
              ariaLabel: '背景与上下文',
              placeholder: '业务场景、系统规模、技术栈等（会并入「身份」段）',
              onChange: value => actions.setField('background', value),
            })),
          createElement(Field, { key: 'successCriteria', label: '成功标准' },
            createElement(TextArea, {
              value: form.successCriteria,
              ariaLabel: '成功标准',
              placeholder: '可验收的完成判据（会并入「目标」段）',
              onChange: value => actions.setField('successCriteria', value),
            })),
        ]),

        // 第 2 组：约束与规则（默认折叠）
        section('rules', [listField('rules'), listField('forbidden')]),

        // 第 3 组：工具策略（默认折叠）
        section('tools', [
          createElement(Field, { key: 'toolPolicy', label: '调用工具策略' },
            createElement('div', { style: { ...rowStyle, flexWrap: 'wrap' } },
              ...[
                ['auto', '自动（交给模型自行判断）'],
                ['manual', '手动（指定要调用的能力）'],
                ['', '不指定'],
              ].map(([value, text]) => createElement('button', {
                key: value === '' ? 'none' : value,
                type: 'button',
                style: chipStyle(form.toolPolicy === value),
                'aria-pressed': form.toolPolicy === value,
                onClick: () => actions.setField('toolPolicy', value),
              }, text)),
            ),
          ),
          form.toolPolicy === 'manual'
            ? createElement(ToolPairEditor, { key: 'manual', form, actions })
            : null,
          listField('toolGuidance'),
          createElement(Field, { key: 'toolFailure', label: '工具失败时的处理' },
            createElement(TextArea, {
              value: form.toolFailure,
              ariaLabel: '工具失败时的处理',
              placeholder: '例如：任何一次工具调用失败，最多重试一次；仍失败则直接报告失败，不要用估计值代替。',
              onChange: value => actions.setField('toolFailure', value),
            })),
        ]),

        // 第 4 组：输出与兜底（默认折叠）
        section('output', [
          createElement(Field, { key: 'outputFormat', label: '输出格式类型' },
            createElement('div', { style: { ...rowStyle, flexWrap: 'wrap' } },
              ...[
                ['', '未指定'],
                ['json', 'JSON'],
                ['markdown', 'Markdown'],
                ['table', '表格'],
                ['text', '纯文本'],
              ].map(([value, text]) => createElement('button', {
                key: value === '' ? 'none' : value,
                type: 'button',
                style: chipStyle(form.outputFormat === value),
                'aria-pressed': form.outputFormat === value,
                onClick: () => {
                  actions.setField('outputFormat', value)
                  // 选骨架时，若正文还是空的（或仍是别的骨架），直接填入骨架。
                  const skeleton = value === '' ? '' : OUTPUT_FORMAT_SKELETONS[value] ?? ''
                  const known = Object.values(OUTPUT_FORMAT_SKELETONS)
                  if (skeleton !== '' && (form.outputSpec.trim() === '' || known.includes(form.outputSpec))) {
                    actions.setField('outputSpec', skeleton)
                  }
                },
              }, text)),
            ),
          ),
          createElement(Field, { key: 'outputSpec', label: '输出格式说明' },
            createElement(TextArea, {
              value: form.outputSpec,
              ariaLabel: '输出格式说明',
              placeholder: '以 JSON 输出，字段如下：…',
              onChange: value => actions.setField('outputSpec', value),
            })),
          listField('fields'),
          createElement(Field, { key: 'languageTone', label: '语言与语气' },
            createElement(TextInput, {
              value: form.languageTone,
              ariaLabel: '语言与语气',
              placeholder: '例如：中文，简洁直接，面向工程师',
              onChange: value => actions.setField('languageTone', value),
            })),
          createElement(Field, { key: 'fallback', label: '数据不足时的行为' },
            createElement(TextArea, {
              value: form.fallback,
              ariaLabel: '数据不足时的行为',
              placeholder: '例如：若关键指标或阈值任一缺失，severity 返回 "info"，并在 data_gaps 中列出缺失项。禁止编造数值。',
              onChange: value => actions.setField('fallback', value),
            })),
          createElement(Field, { key: 'examples', label: '少样本示例' },
            createElement(TextArea, {
              value: form.examples,
              ariaLabel: '少样本示例',
              placeholder: '给 1-2 个输入/输出对照示例',
              onChange: value => actions.setField('examples', value),
            })),
        ]),

        // 预览：把最终提示词摊开，便于发送前确认。
        createElement('details', { style: { fontSize: 12 } },
          createElement('summary', { style: { cursor: 'pointer', color: C.textSecondary } },
            `预览已构建的提示词（${prompt.length} 字）`),
          createElement('pre', {
            style: {
              margin: '8px 0 0',
              maxHeight: 260,
              overflow: 'auto',
              padding: 10,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              lineHeight: 1.55,
            },
          }, prompt === '' ? '（尚未填写身份与目标）' : prompt),
        ),
      ),

      // 底部操作栏：模板/导入/导出/清空在左，返回在右。
      createElement(
        'div',
        { style: modalFootStyle },
        createElement('div', { style: { ...rowStyle, flexWrap: 'wrap' } },
          createElement('select', {
            style: { ...buttonStyle, padding: '0 8px' },
            value: '',
            title: '用内置模板填充表单',
            'aria-label': '用内置模板填充表单',
            onChange: event => {
              const picked = TEMPLATES.find(item => item.id === event.target.value)
              event.target.value = ''
              if (picked !== undefined) actions.setForm(picked.build())
            },
          },
          createElement('option', { value: '' }, '模板…'),
          ...TEMPLATES.map(item => createElement('option', { key: item.id, value: item.id }, item.label)),
          ),
          createElement('button', {
            type: 'button',
            style: buttonStyle,
            title: '从 JSON 导入表单',
            onClick: () => importRef.current?.click(),
          }, '导入'),
          createElement('input', {
            ref: importRef,
            type: 'file',
            accept: 'application/json,.json',
            hidden: true,
            onChange: importForm,
          }),
          createElement('button', {
            type: 'button',
            style: buttonStyle,
            title: '导出当前表单为 JSON',
            onClick: exportForm,
          }, '导出'),
          createElement('button', {
            type: 'button',
            style: buttonStyle,
            title: '清空全部字段',
            onClick: () => actions.reset(),
          }, '清空'),
        ),
        createElement('button', {
          type: 'button',
          style: { ...buttonStyle, borderColor: C.borderStrong },
          onClick: () => setReturnPrompt(value => !value),
        }, '返回输入框'),
      ),
    ),
  )
}

/**
 * 输入框底部工具栏里的入口（`conversation.input.left`，与计划/权限控件同一行）。
 *
 * 只负责切换开关：置真后由同一 store 句柄驱动的 `StructuredInputPanel` 弹出表单。
 * 两者共用实例，因此不需要任何跨注册的状态同步。
 * @param props - 槽位 props（store 座位与 sessionId）。
 * @returns 入口按钮元素。
 */
export function StructuredInputTrigger(props) {
  const { useStore, actions, sessionId } = props
  const active = useStore(state => state.active === true)
  const disabled = sessionId === undefined
  return createElement('button', {
    type: 'button',
    'data-structured-prompt-trigger': '',
    style: {
      ...triggerButtonStyle,
      borderColor: active ? C.accent : C.border,
      background: active ? C.accentSoft : 'transparent',
      color: active ? C.text : C.textSecondary,
      opacity: disabled ? 0.5 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    },
    title: '结构化输入任务：打开结构化提示词表单',
    'aria-haspopup': 'dialog',
    'aria-expanded': active,
    disabled,
    // 不让按钮抢走输入框的焦点，输入可以无缝继续。
    onMouseDown: event => { event.preventDefault() },
    onClick: () => { actions.open() },
  }, '结构化输入任务')
}
