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
const { TEMPLATES } = await import(
  pathToFileURL(resolve(CLIENT, '..', 'shared', 'templates.ts')).href
)
const { buildSystemPromptSections, renderPrompt } = await import(
  pathToFileURL(resolve(CLIENT, '..', 'shared', 'prompt.ts')).href
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
/** 已发送的成稿（面板把宿主的 onSend 透传给弹窗）。 */
const sent = []
const onSend = (text) => { sent.push(text) }

/** 把 store 实例包装成组件需要的 useStore/actions/onSend 座位。 */
function propsFor(extra = {}) {
  return {
    useStore: selector => selector(instance.getSnapshot()),
    actions: instance.actions,
    onSend,
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

check('标题栏提供关闭按钮', modal.html.includes('aria-label="关闭"'))

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
check('底部提供复制按钮', filled.html.includes('>复制<'))
check('底部提供发送按钮', filled.html.includes('>发送<'))

// 回归防线：返回/同步相关 UI 已整体删除 —— 它既没有存在必要，实测还会卡住。
check('不再出现返回/同步入口',
  !filled.html.includes('返回输入框')
  && !filled.html.includes('同步并返回')
  && !filled.html.includes('不同步，直接返回'))

// 操作类按钮集中在底部操作栏，不出现在顶部标题栏。
const headHtml = filled.html.slice(
  filled.html.indexOf('结构化输入任务'),
  filled.html.indexOf('aria-label="身份"'),
)
check('标题栏只保留标题与关闭（不含操作按钮）',
  !headHtml.includes('>导出<') && !headHtml.includes('>清空<') && !headHtml.includes('>发送<'),
  headHtml.slice(0, 160))
check('底部操作栏含全部操作控件',
  ['模板…', '>导入<', '>导出<', '>清空<', '>复制<', '>发送<'].every(label => filled.html.includes(label)))

// 发送：把成稿交给宿主（此处是测试记录的 onSend），并由弹窗自行关闭。
// SSR 无法点击，因此断言按钮可点（未勾选必填时禁用）与成稿就绪。
/**
 * 取出「发送」按钮的开标签。
 *
 * 不能用 title 定位：「复制」按钮在必填缺失时带**同一个** title，只查 title 的断言
 * 在两个按钮上都成立，等于没锁住发送按钮。
 * @param html - 一次渲染的结果。
 * @returns 发送按钮的开标签（找不到时为空串）。
 */
const sendTagOf = (html) => /<button[^>]*>发送<\/button>/.exec(html)?.[0] ?? ''
/** 同一个正则的命中数：多一个「发送」按钮就会让上面的定位取到错的那个。 */
const sendTagCount = (html) => (html.match(/<button[^>]*>发送<\/button>/g) ?? []).length
check('页面上只有一个「发送」按钮', sendTagCount(filled.html) === 1, String(sendTagCount(filled.html)))
check('成稿就绪时发送按钮可用',
  sendTagOf(filled.html).includes('title="把提示词投递进当前会话"')
  && !sendTagOf(filled.html).includes('disabled'),
  sendTagOf(filled.html))
instance.actions.setField('role', '')
const missingRequired = panel()
check('必填未填时发送按钮禁用',
  sendTagOf(missingRequired.html).includes('disabled')
  && sendTagOf(missingRequired.html).includes('title="身份与目标为必填"'),
  sendTagOf(missingRequired.html))
instance.actions.setField('role', '身份示例')

// 格式类型被手写说明覆盖时，界面必须说出来：否则用户改选格式后看到的是与选择不符的
// 契约，而界面仍高亮着新值（子代理审查发现的静默分叉，修复后由这条断言守住）。
if (instance.getSnapshot().collapsed.includes('output')) instance.actions.toggleSection('output')
instance.actions.setField('outputFormat', 'json')
instance.actions.setField('outputSpec', '以 TOML 输出，键为 summary。')
const shadowedHtml = panel()
check('格式类型被手写说明覆盖时给出提示',
  shadowedHtml.html.includes('格式类型已不生效'))
instance.actions.setField('outputSpec', '')
const notShadowedHtml = panel()
check('说明为空时不提示格式类型失效',
  !notShadowedHtml.html.includes('格式类型已不生效'))
instance.actions.setField('outputFormat', '')

// ---- 7b) 模板：下拉带出场景，套用后给出场景条 ----
//
// 场景条只在「套用了某套模板」时出现，且必须说清模板给的是形态化目标 —— 模板使用率上来
// 之后最容易出的问题就是只选模板、不复述具体任务，产物随之变泛。锚点用
// `data-applied-template` 而不是文案：预览区会渲染提示词正文，靠文本定位会被同名字样
// 代偿（文件头部记着这条教训）。
// 7b 节的统一取用函数。两类断言都用它：
//  - **该出现**的断言：失败时 detail 里带上渲染错误，不必靠猜；
//  - **不该出现**的断言：先确认渲染成功 —— 否则 `!html.includes(...)` 会在渲染崩溃时假通过
//    （`render()` 把抛错收成空 HTML）。本批踩到过：一次 props 改名的崩溃里，三条这样的断言
//    全部显示 OK。
/**
 * 渲染面板并保证渲染成功。
 * @returns 成功时的 HTML；渲染抛错时给出带标记的文本，使两类断言都变红。
 */
const okHtml = () => {
  const out = panel()
  return out.error === null ? out.html : `render-failed: ${String(out.error)}`
}
const renderFailed = html => html.startsWith('render-failed')

instance.actions.setAppliedTemplate('')
const optionsHtml = okHtml()
check('下拉所在的面板能渲染（下面两条下拉断言的前提）',
  !renderFailed(optionsHtml), optionsHtml.slice(0, 160))
const missingScenes = TEMPLATES
  .filter(item => !optionsHtml.includes(`${item.label} · ${item.whenToUse}`))
  .map(item => item.id)
check('下拉选项带出每套模板的一句话场景', missingScenes.length === 0, missingScenes.join(', '))
// 选项文本变长后这条工具的宽度只能靠 `maxWidth` 兜住，否则最长的选项会把导入/导出/清空挤到
// 下一行。正则锚定在 select 元素**内部**：别处出现同样的数值不该让这条通过。
check('下拉有宽度约束（选项变长不会把底部按钮挤下去）',
  /<select[^>]*style="[^"]*max-width:260px/.test(optionsHtml),
  (/<select[^>]*>/.exec(optionsHtml) ?? [''])[0].slice(0, 160))

instance.actions.setAppliedTemplate('code-review')
const appliedHtml = okHtml()
// 取场景条**元素内部**的文本：`whenToUse` 同时出现在下拉选项里，用整页 HTML 查会被下拉
// 代偿 —— 定点突变时实测该断言在场景条完全消失后仍然通过。
const appliedBanner = (/<p[^>]*data-applied-template[^>]*>([\s\S]*?)<\/p>/.exec(appliedHtml) ?? [])[1] ?? ''
check('套用模板后渲染场景条', appliedBanner !== '', appliedBanner.slice(0, 160))
const codeReview = TEMPLATES.find(item => item.id === 'code-review')
// 形式断言而非硬编码字面量：拿模板自己的 label 与场景去比，换模板不必改断言，而"场景条
// 写的是别的模板的场景"会红。
check('场景条用的是该模板自己的 label 与场景',
  codeReview !== undefined
  && appliedBanner.includes(codeReview.label)
  && appliedBanner.includes(codeReview.whenToUse),
  appliedBanner.slice(0, 160))
check('场景条提醒把具体任务写进「目标」（钉的是措辞，改文案需同步改断言）',
  appliedBanner.includes('形态化') && appliedBanner.includes('具体任务'), appliedBanner)
check('场景条只渲染一条',
  (appliedHtml.match(/data-applied-template/g) ?? []).length === 1)

// README 声称的两条边界要有断言守护 —— 只有文档、没有守护的承诺迟早会漂。
instance.actions.close()
instance.actions.open()
const reopenedHtml = okHtml()
check('关闭重开不清套用标记（同一会话内）',
  !renderFailed(reopenedHtml) && reopenedHtml.includes('data-applied-template'),
  reopenedHtml.slice(0, 120))
instance.actions.setField('goal', '手改过的目标')
const editedHtml = okHtml()
check('手改字段不清套用标记',
  !renderFailed(editedHtml) && editedHtml.includes('data-applied-template'),
  editedHtml.slice(0, 120))

instance.actions.setAppliedTemplate('')
const blankHtml = okHtml()
check('未套用模板时不渲染场景条',
  !renderFailed(blankHtml) && !blankHtml.includes('data-applied-template'),
  blankHtml.slice(0, 120))
instance.actions.setAppliedTemplate('code-review-typo')
const typoHtml = okHtml()
check('解析不到的模板 id 不渲染场景条（界面不声称说不出来源的来源）',
  !renderFailed(typoHtml) && !typoHtml.includes('data-applied-template'),
  typoHtml.slice(0, 120))
instance.actions.setAppliedTemplate('code-review')
instance.actions.reset()
const clearedPanel = panel()
check('清空表单会一并清掉套用标记',
  clearedPanel.error === null
  && instance.getSnapshot().appliedTemplate === ''
  && !clearedPanel.html.includes('data-applied-template'),
  clearedPanel.error === null ? '' : String(clearedPanel.error))
// 套用标记是**界面陈述**，不参与提示词构建：成稿只由 `form` 决定。这条边界的守护放在
// 渲染套里 —— 两边共用 `shared/prompt.ts`，所以这里比对的正是发送/复制的那份文本。
const promptOf = () => renderPrompt(buildSystemPromptSections(instance.getSnapshot().form))
instance.actions.setField('role', '身份示例')
instance.actions.setField('goal', '目标示例')
const promptBefore = promptOf()
instance.actions.setAppliedTemplate('code-review')
const promptAfter = promptOf()
check('套用标记不参与提示词构建（成稿逐字不变）', promptBefore === promptAfter,
  promptBefore === promptAfter ? '' : `\n--- 套用前 ---\n${promptBefore}\n--- 套用后 ---\n${promptAfter}`)
// 补回被 `reset()` 清掉的字段值：第 8 节的「预览区会渲染提示词正文」这一维需要页面上
// 真的有正文（那条断言正是为了防"字段控件缺失被预览正文代偿"才这么写的）。
const restoredHtml = okHtml()
check('补回字段值后预览区重新出现正文',
  restoredHtml.includes('# 身份') && restoredHtml.includes('身份示例'), restoredHtml.slice(0, 160))

// 剪贴板降级：Node 里没有 navigator.clipboard，应走 execCommand 路径而不是抛错。
const { copyText } = await import(pathToFileURL(resolve(CLIENT, 'ui', 'clipboard.ts')).href)
check('空文本不写剪贴板', (await copyText('')) === false)
const copied = []
const originalDoc = globalThis.document
globalThis.document = {
  body: { appendChild() {} },
  createElement: () => ({
    style: {},
    setAttribute() {},
    select() { copied.push('selected') },
    remove() {},
  }),
  execCommand: (cmd) => cmd === 'copy',
}
const fallbackOk = await copyText('成稿正文')
globalThis.document = originalDoc
check('navigator.clipboard 缺失时降级到 execCommand', fallbackOk === true && copied.length === 1,
  `ok=${String(fallbackOk)} selected=${copied.length}`)

// 17 个字段必须各自有 DOM 锚点。只匹配分组标签文本是不够的 —— 预览区会渲染提示词
// 正文与逐段占用，正文里的「# 身份」「# 硬性规则」等字样会让子串命中，于是"某个字段
// 没有任何控件"这种缺陷照样能过（实测：三个分组折叠、只填身份与目标时也能命中）。
// 所以逐字段定位到它自己的控件：单值字段看 aria-label，逐条字段先补一条空条目再看
// 带序号的 aria-label，两个枚举字段看各自独有的 chip —— 这些锚点都无法被预览代偿。
check('17 个字段各自有 DOM 锚点（展开全部分组）', (() => {
  for (const id of ['rules', 'tools', 'output']) {
    if (instance.getSnapshot().collapsed.includes(id)) instance.actions.toggleSection(id)
  }
  // 逐条字段在空数组下不渲染任何控件，先各补一条才谈得上"有没有控件"。
  for (const key of ['rules', 'forbidden', 'toolGuidance', 'fields']) {
    if (instance.getSnapshot().form[key].length === 0) instance.actions.addItem(key, '')
  }
  instance.actions.setField('toolPolicy', 'manual')
  if (instance.getSnapshot().form.callableTools.length === 0) instance.actions.addTool()
  const html = panel().html
  const hasLabel = label => html.includes(`aria-label="${label}"`)
  // 单值字段，以及手动模式下按索引配对的两个工具字段，都用 aria-label 定位。
  const labeled = ['身份', '目标', '背景与上下文', '成功标准', '工具失败时的处理',
    '输出格式说明', '语言与语气', '数据不足时的行为', '少样本示例',
    '第 1 个工具名', '第 1 个工具的用途']
  // 逐条字段的控件名是「字段标签 + 第 N 条」，标签文本取自 `ui/config.ts`。
  const listed = ['硬性规则（每行一条，会按 1. 2. 3. 编号） 第 1 条',
    '禁止行为（每行一条） 第 1 条', '工具使用策略（每行一条） 第 1 条',
    '字段级说明（每行一条） 第 1 条']
  // 「输出格式类型」与「调用工具策略」是 chip 组，没有 aria-label，用独有的选项定位。
  return [...labeled, ...listed].every(hasLabel)
    && html.includes('>手动（指定要调用的工具）</button>')
    && html.includes('>纯文本</button>')
})())

if (failed > 0) {
  console.error(`\n${failed} 项渲染测试未通过。`)
  process.exit(1)
}
console.log('\n全部渲染测试通过。')
