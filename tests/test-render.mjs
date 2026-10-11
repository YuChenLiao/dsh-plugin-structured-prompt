/**
 * 离线渲染测试：用 React 服务端渲染验证两个槽位组件。
 *
 * 结构：
 *  - `StructuredInputTrigger`（`ui/Trigger.tsx`）→ `conversation.input.left`
 *  - `StructuredInputPanel`（`ui/Panel.tsx`）→ `conversation.input.dock`
 *
 * 除了行为断言，这里还直接断言两个**布局不变量对象**（`ui/styles.ts` 的
 * `sectionStyle` 与 `modalBodyStyle`）—— 历史上三次 UI 事故都出在这两个常量上：
 * 分组被卡片 `overflow: hidden` 裁剪、滚动条没挂到内容区、分组误用 `min-height: 0`
 * 导致子元素压叠。
 *
 * 用法：node --import tsx --import ./tools/lib/loader-hook.mjs tests/test-render.mjs
 */
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client')
const { createStructuredInputStore } = await import(pathToFileURL(resolve(CLIENT, 'store.ts')).href)
const { StructuredInputPanel } = await import(
  pathToFileURL(resolve(CLIENT, 'ui', 'Panel.tsx')).href
)
const { StructuredInputTrigger } = await import(
  pathToFileURL(resolve(CLIENT, 'ui', 'Trigger.tsx')).href
)
const { sectionStyle, modalBodyStyle } = await import(
  pathToFileURL(resolve(CLIENT, 'ui', 'styles.ts')).href
)

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : `\n      ${detail}`}`)
  if (!ok) failed += 1
}

/** 渲染一次并返回 HTML；渲染抛错即视为该断言失败。 */
function render(element) {
  try {
    return { html: renderToStaticMarkup(element), error: null }
  } catch (error) {
    return { html: '', error }
  }
}

const store = createStructuredInputStore()
const instance = store.create('session-test')
const draftWrites = []
const setDraft = (text) => { draftWrites.push(text) }

/** 把 store 实例包装成组件需要的 useStore/actions/setDraft 座位。 */
function propsFor(extra = {}) {
  return {
    useStore: selector => selector(instance.getSnapshot()),
    actions: instance.actions,
    setDraft,
    sessionId: 'session-test',
    ...extra,
  }
}

const trigger = extra => render(createElement(StructuredInputTrigger, propsFor(extra)))
const panel = extra => render(createElement(StructuredInputPanel, propsFor(extra)))

// ---- 1) 入口按钮（输入框底部工具栏）----

instance.actions.close()
const triggerOff = trigger()
check('入口按钮可渲染', triggerOff.error === null, triggerOff.error === null ? '' : String(triggerOff.error))
check('入口文案为「结构化输入任务」', triggerOff.html.includes('结构化输入任务'))
check('未打开时 aria-expanded 为 false', triggerOff.html.includes('aria-expanded="false"'))
check('入口以 dialog 弹出（aria-haspopup）', triggerOff.html.includes('aria-haspopup="dialog"'))

instance.actions.open()
const triggerOn = trigger()
check('打开时入口高亮（aria-expanded 为 true）', triggerOn.html.includes('aria-expanded="true"'))

instance.actions.close()
const triggerDisabled = trigger({ sessionId: undefined })
check('没有会话时入口禁用', triggerDisabled.html.includes('disabled'))

// ---- 2) 弹窗形态 ----

instance.actions.close()
const closedPanel = panel()
check('未打开时弹窗不占用空间', closedPanel.error === null && closedPanel.html === '',
  closedPanel.error === null ? closedPanel.html : String(closedPanel.error))

instance.actions.open()
const modal = panel()
check('打开时弹窗可渲染', modal.error === null, modal.error === null ? '' : String(modal.error))
check('弹窗以 dialog 呈现', modal.html.includes('role="dialog"') && modal.html.includes('aria-modal="true"'))
check('弹窗宽度固定（clamp）', modal.html.includes('width:clamp('))
check('弹窗最多占 70%（不占满窗口）', modal.html.includes('max-height:70vh'))

// 只检查弹窗根元素自身的样式：内部按钮有固定 height 是正常的。
const modalRootStyle = (/data-structured-prompt-modal=""[^>]*style="([^"]*)"/.exec(modal.html) ?? [])[1] ?? ''
check('弹窗根元素没有固定高度（由内容决定）', !/(?:^|[;"\s])height:/.test(modalRootStyle), modalRootStyle)
// `max-width:100%` 是宽度约束（合理）；这里只关心高度不取视口高。
check('弹窗高度上限不是视口高（不会占满））',
  !/(?:max-|min-)?height:[^;"]*100vh/.test(modalRootStyle), modalRootStyle)

// 回归防线：点遮罩不应关闭弹窗（误触会丢失已填内容）。遮罩上不能有点击处理器。
const maskTag = (/<div[^>]*style="[^"]*position:fixed[^"]*"[^>]*>/.exec(modal.html) ?? [])[0] ?? ''
check('遮罩是弹窗的第一层容器', maskTag !== '', maskTag.slice(0, 120))
check('遮罩没有绑定点击关闭', maskTag !== '' && !/onclick/i.test(maskTag), maskTag.slice(0, 200))

// 关闭入口：标题栏的 × 与底部的「返回输入框」都要在。
check('标题栏提供关闭按钮',
  modal.html.includes('aria-label="关闭"') && modal.html.includes('关闭（不改动输入框内容）'))
check('底部仍保留返回输入框', modal.html.includes('返回输入框'))

// ---- 3) 默认折叠：只有基础信息展开 ----

check('渲染出四个分组标题',
  ['基础信息', '约束与规则', '工具策略', '输出与兜底'].every(title => modal.html.includes(title)))
check('默认展开基础信息（可见身份字段）', modal.html.includes('aria-label="身份"'))
check('默认不展开约束与规则（看不到硬性规则字段）', !modal.html.includes('硬性规则（每行一条'))
check('默认不展开工具策略（看不到调用工具策略）', !modal.html.includes('调用工具策略'))
check('默认不展开输出与兜底（看不到少样本示例）', !modal.html.includes('少样本示例'))
check('折叠组标记为收起', (modal.html.match(/aria-expanded="false"/g) ?? []).length >= 3)

instance.actions.toggleSection('tools')
const toolsOpen = panel()
check('展开工具策略后可见其字段', toolsOpen.html.includes('调用工具策略'))
check('展开工具策略后其它两组仍折叠', !toolsOpen.html.includes('少样本示例'))
instance.actions.toggleSection('tools')

// ---- 4) 文本域自适应高度 + 布局不变量 ----

check('文本域不写死 rows', !/\brows="/.test(toolsOpen.html) && !/\brows="/.test(modal.html))
check('文本域带自适应高度约束（min/max-height）',
  modal.html.includes('min-height') && modal.html.includes('max-height'))

// 分组曾被卡片包裹，overflow:hidden 把"背景与上下文""语言与语气"等字段裁掉，导致
// 内容看起来被隐藏、也轮不到滚动条。分组必须不裁剪、不限高、不用卡片。
check('分组容器不裁剪内容（无 overflow:hidden）',
  sectionStyle.overflow === undefined && sectionStyle.overflowY === undefined,
  JSON.stringify(sectionStyle))
check('分组容器不限制高度（无 maxHeight/height）',
  sectionStyle.maxHeight === undefined && sectionStyle.height === undefined)
check('分组不用卡片包裹（无边框与圆角）',
  sectionStyle.border === undefined && sectionStyle.borderRadius === undefined)
// 分组上写 `min-height: 0` 会把分组压到内容高度以下，子元素互相压叠
// （症状是分组标题与上一个字段的输入框重叠）。该属性只属于滚动容器。
check('分组容器不被压缩（不写 minHeight:0）', sectionStyle.minHeight === undefined,
  `minHeight = ${String(sectionStyle.minHeight)}`)

// 滚动条挂在弹窗内容区，且它必须能在弹窗内收缩（flex + minHeight:0），否则溢出
// 内容会被弹窗的 overflow:hidden 裁掉。
check('弹窗内容区是滚动容器（overflow-y:auto）', modalBodyStyle.overflowY === 'auto')
check('弹窗内容区宽度方向不滚动（避免横向滚动条）', modalBodyStyle.overflowX === 'hidden')
check('弹窗内容区可在弹窗内收缩（flex + minHeight:0）',
  modalBodyStyle.flex === '1 1 auto' && modalBodyStyle.minHeight === 0)
check('弹窗内容区预留滚动条槽位（内容增减不跳动）',
  modalBodyStyle.scrollbarGutter === 'stable')
check('滚动容器挂到了弹窗内容区', modal.html.includes('data-scroll=""'))

// ---- 5) 工具策略：自动（模型判断）/ 手动（用户点名工具）----

instance.actions.setField('toolPolicy', 'auto')
instance.actions.toggleSection('tools')
const auto = panel()
check('自动策略不渲染工具点名输入框', !auto.html.includes('第 1 个工具名'))

instance.actions.setField('toolPolicy', 'manual')
const manualEmpty = panel()
check('手动策略渲染工具点名入口', manualEmpty.html.includes('可调用的工具（工具名 + 用途）'))
check('手动策略提示尚未点名工具', manualEmpty.html.includes('尚未点名任何工具'))
check('手动策略提供添加按钮', manualEmpty.html.includes('+ 添加一个工具'))
// 不再从"已安装清单"里勾选（DSH 插件清单列的是自带插件，skills 也不属于本插件
// 职责；工具检索在输入框的 / 菜单里）。
check('手动策略不再渲染清单选择器',
  !manualEmpty.html.includes('选择 skills') && !manualEmpty.html.includes('选择插件'))
check('手动策略不再出现清单读取状态',
  !manualEmpty.html.includes('读取中') && !manualEmpty.html.includes('读取失败'))

// 填一个工具后应渲染出配对的两个输入框
instance.actions.addTool()
instance.actions.setItem('callableTools', 0, 'query_metrics')
instance.actions.setItem('toolSlots', 0, '拉取指标')
const manualFilled = panel()
check('点名工具后渲染工具名输入框', manualFilled.html.includes('aria-label="第 1 个工具名"'))
check('点名工具后渲染用途输入框', manualFilled.html.includes('aria-label="第 1 个工具的用途"'))
check('工具名写入表单值', manualFilled.html.includes('value="query_metrics"'))
check('用途写入表单值', manualFilled.html.includes('value="拉取指标"'))
check('工具名与用途数组长度一致',
  instance.getSnapshot().form.callableTools.length === instance.getSnapshot().form.toolSlots.length)
instance.actions.removeTool(0)
check('删除工具后两个数组同步清空',
  instance.getSnapshot().form.callableTools.length === 0
  && instance.getSnapshot().form.toolSlots.length === 0)
instance.actions.setField('toolPolicy', '')

// ---- 6) 开关来回切换不触发 hook 规则错误 ----

let toggleError = null
try {
  for (const active of [true, false, true, false, true]) {
    if (active) instance.actions.open()
    else instance.actions.close()
    renderToStaticMarkup(createElement(StructuredInputPanel, propsFor()))
    renderToStaticMarkup(createElement(StructuredInputTrigger, propsFor()))
  }
} catch (error) {
  toggleError = error
}
check('开关来回切换不触发 React hook 规则错误', toggleError === null,
  toggleError === null ? '' : String(toggleError))

// ---- 7) 填写后预览与返回入口 ----

instance.actions.open()
instance.actions.setField('role', '身份示例')
instance.actions.setField('goal', '目标示例')
const filled = panel()
check('填写必填后不再提示缺失', !filled.html.includes('还差必填'))
check('预览区出现已构建提示词', filled.html.includes('# 身份') && filled.html.includes('身份示例'))
check('返回入口存在', filled.html.includes('返回输入框'))

// 操作类按钮集中在底部操作栏，不出现在顶部标题栏。
const headHtml = filled.html.slice(
  filled.html.indexOf('结构化输入任务'),
  filled.html.indexOf('aria-label="身份"'),
)
check('标题栏只保留标题与关闭（不含操作按钮）',
  !headHtml.includes('>导出<') && !headHtml.includes('>清空<') && !headHtml.includes('返回输入框'),
  headHtml.slice(0, 160))
check('底部操作栏含全部操作控件',
  ['模板…', '>导入<', '>导出<', '>清空<', '返回输入框'].every(label => filled.html.includes(label)))

check('18 项字段齐备（展开全部后抽样）', (() => {
  for (const id of ['rules', 'tools', 'output']) {
    if (instance.getSnapshot().collapsed.includes(id)) instance.actions.toggleSection(id)
  }
  const all = panel()
  return ['身份', '目标', '背景与上下文', '成功标准', '硬性规则', '禁止行为', '调用工具策略',
    '工具使用策略', '工具失败时的处理', '输出格式说明', '输出格式类型', '语言与语气',
    '字段级说明', '数据不足时的行为', '少样本示例'].every(label => all.html.includes(label))
})())

if (failed > 0) {
  console.error(`\n${failed} 项渲染测试未通过。`)
  process.exit(1)
}
console.log('\n全部渲染测试通过。')
