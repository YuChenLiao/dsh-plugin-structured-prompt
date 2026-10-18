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
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client')
const STRUCTURED = resolve(CLIENT, '..', 'components', 'structured')
const LIBRARY = resolve(CLIENT, '..', 'components', 'library')
const SHARED = resolve(CLIENT, '..', 'shared')
const { createStructuredInputStore } = await import(
  pathToFileURL(resolve(STRUCTURED, 'client', 'store.ts')).href
)
const { createLibraryStore } = await import(
  pathToFileURL(resolve(LIBRARY, 'client', 'store.ts')).href
)
const { StructuredInputPanel } = await import(
  pathToFileURL(resolve(STRUCTURED, 'client', 'ui', 'Panel.tsx')).href
)
const { StructuredInputTrigger } = await import(
  pathToFileURL(resolve(STRUCTURED, 'client', 'ui', 'Trigger.tsx')).href
)
const { LibraryPanel } = await import(
  pathToFileURL(resolve(LIBRARY, 'client', 'ui', 'Panel.tsx')).href
)
const { LibraryTrigger } = await import(
  pathToFileURL(resolve(LIBRARY, 'client', 'ui', 'Trigger.tsx')).href
)
// 样式住在真正的 CSS 文件里（构建期编译 + 注入），所以测试直接读源码文本断言：
//   `panel.css`        —— 全局注入那份（伪类、滚动条、锚在共享属性上的后代选择器）
//   `panel.module.css` —— CSS Modules 那份（组件引用的类）
const panelCssText = readFileSync(resolve(SHARED, 'ui', 'panel.css'), 'utf8')
const moduleCssText = readFileSync(resolve(SHARED, 'ui', 'panel.module.css'), 'utf8')
// 「rect → 遮罩样式」的纯函数：真实布局测不了，但这条映射可以离线断言。
const { frameFromRect } = await import(
  pathToFileURL(resolve(SHARED, 'ui', 'use-dialog-frame.ts')).href
)

/**
 * 取出某个类的声明块（只取那一条规则，不含伪类变体）。
 * @param name - 类名。
 * @returns 压平空白后的声明文本。
 */
const ruleOf = (name) => {
  const match = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(moduleCssText)
  return (match?.[1] ?? '').replace(/\s+/g, ' ').trim()
}
const { TEMPLATES } = await import(
  pathToFileURL(resolve(STRUCTURED, 'shared', 'templates.ts')).href
)
const { buildSystemPromptSections, renderPrompt } = await import(
  pathToFileURL(resolve(STRUCTURED, 'shared', 'prompt.ts')).href
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
const libraryStore = createLibraryStore()
const libraryInstance = libraryStore.create('session-test')
/** 已发送的内容（两个组件的面板都把宿主的 onSend 透传给弹窗）。 */
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

/** 提示词库组件的座位：它有自己的 store 与动作，因此要与结构化组件分别构造。 */
function libraryPropsFor(extra = {}) {
  return {
    useStore: selector => selector(libraryInstance.getSnapshot()),
    actions: libraryInstance.actions,
    onSend,
    sessionId: 'session-test',
    ...extra,
  }
}

const libraryTrigger = extra => render(createElement(LibraryTrigger, libraryPropsFor(extra)))
const libraryPanel = extra => render(createElement(LibraryPanel, libraryPropsFor(extra)))

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
// 尺寸约束现在住在 CSS 里（组件只引用类名），所以读样式文本断言。
const modalRule = ruleOf('modal')
check('弹窗宽度固定（clamp）', /width:\s*clamp\(/.test(modalRule), modalRule)
check('弹窗最多占 70%（不占满窗口）', /max-height:\s*70vh/.test(modalRule), modalRule)
check('弹窗高度上限不是视口高（不会占满）', !/height:\s*[^;]*100vh/.test(modalRule), modalRule)
check('弹窗根不再写内联样式（尺寸由类名承担）',
  !/data-structured-prompt-modal=""[^>]*style=/.test(modal.html))

// 回归防线：点遮罩不应关闭弹窗（误触会丢失已填内容）。遮罩上不能有点击处理器。
const maskTag = (/<div[^>]*data-dsh-prompt-mask[^>]*>/.exec(modal.html) ?? [])[0] ?? ''
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
// 高度上下限现在住在 CSS（`.textarea`），JS 兜底也从 computed style 读同一个值 ——
// 断言因此读样式文本，顺带守住"这个约束只有一份"。
const textareaRule = ruleOf('textarea')
check('文本域带自适应高度约束（min/max-height）',
  /min-height:\s*\d+px/.test(textareaRule) && /max-height:\s*\d+px/.test(textareaRule), textareaRule)

// 分组曾被卡片包裹，overflow:hidden 把"背景与上下文""语言与语气"等字段裁掉，导致
// 内容看起来被隐藏、也轮不到滚动条。分组必须不裁剪、不限高、不用卡片。
const sectionRule = ruleOf('section')
check('分组容器不裁剪内容（无 overflow）',
  !/overflow\s*:/.test(sectionRule), sectionRule)
check('分组容器不限制高度（无 height / max-height）',
  !/(^|[^-])height\s*:|max-height\s*:/.test(sectionRule), sectionRule)
check('分组不用卡片包裹（无边框与圆角）',
  !/(border|border-radius)\s*:/.test(sectionRule), sectionRule)
// 分组上写 `min-height: 0` 会把分组压到内容高度以下，子元素互相压叠
// （症状是分组标题与上一个字段的输入框重叠）。该属性只属于滚动容器。
check('分组容器不被压缩（无 min-height）',
  !/min-height\s*:/.test(sectionRule), sectionRule)

// 滚动条挂在弹窗内容区，且它必须能在弹窗内收缩（flex + min-height:0），否则溢出
// 内容会被弹窗的 overflow:hidden 裁掉。
const bodyRule = ruleOf('modalBody')
check('弹窗内容区是滚动容器（overflow-y: auto）', /overflow-y:\s*auto/.test(bodyRule), bodyRule)
check('弹窗内容区宽度方向不滚动（overflow-x: hidden）', /overflow-x:\s*hidden/.test(bodyRule), bodyRule)
check('弹窗内容区可在弹窗内收缩（flex + min-height）',
  /flex:\s*1 1 auto/.test(bodyRule) && /min-height:\s*0/.test(bodyRule), bodyRule)
check('弹窗内容区预留滚动条槽位（scrollbar-gutter）',
  /scrollbar-gutter:\s*stable/.test(bodyRule), bodyRule)
check('滚动容器挂到了弹窗内容区', modal.html.includes('data-scroll=""'))

// 遮罩的定位基准：CSS 里只给 `inset: 0`（整视口）作**回退**，真正的位置由 `useDialogFrame`
// 按弹窗所在的列算出来（右侧栏打开时对话列会变窄，按视口居中会偏右、被右栏压住）。
const maskRule = ruleOf('mask')
check('遮罩以 fixed + inset 作回退（测不到列时退回整视口居中）',
  /position:\s*fixed/.test(maskRule) && /inset:\s*0/.test(maskRule), maskRule)
check('按列居中由共享实现承担（两个弹窗同一处）',
  readFileSync(resolve(SHARED, 'ui', 'use-dialog-frame.ts'), 'utf8').includes('getBoundingClientRect'))

// 注入样式（`shared/ui/panel.css`）的**选择器语义**。组件拆分那批的阻断正是出在这里：把「后代选择器」
// 写成逗号分隔的列表后，裸的 `[data-…-modal]` 会**无条件命中弹窗根元素**，于是弹窗拿到了滚动条的
// `width/height` 与禁用按钮的 `opacity` —— 真实浏览器里塌成 10px 高、半透明，而八套测试全绿。
// 规则：只由共享属性组成的项，不许出现在多项选择器列表里。
// 先**剥掉注释**再按块切分。这一点本身就是个教训：原先用 `.filter(text => !text.includes('*'))`
// 排除注释，而第一轮那条错法（裸属性混进滚动条那段）恰好写在注释之后 —— 整段被丢掉，于是这条断言
// 对真正的回归**零红**（复审用副本突变实测发现）。剥注释是唯一正确的过滤方式。
const cssGroups = panelCssText
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('}')
  .map(chunk => (chunk.split('{')[0] ?? '').trim())
  .filter(text => text !== '')
const bareSharedSelectors = cssGroups.filter((group) => {
  const items = group.split(',').map(item => item.trim()).filter(item => item !== '')
  return items.length > 1 && items.some(item => /^\[data-dsh-prompt-(panel|trigger)\]$/.test(item))
})
check('panel.css 不把裸共享属性混进选择器列表（否则无条件命中元素自身）',
  bareSharedSelectors.length === 0, bareSharedSelectors.join(' || '))
check('panel.css 的选择器都锚在共享属性上（将来加组件不必改样式）',
  cssGroups.length > 0 && cssGroups.every(group => group.includes('[data-dsh-prompt-')),
  cssGroups.filter(group => !group.includes('[data-dsh-prompt-')).join(' || '))
check('表单弹窗根带共享属性 data-dsh-prompt-panel（样式才覆盖得到）',
  modal.html.includes('data-dsh-prompt-panel'))

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
// 宽度约束现在住在 CSS（`.templateSelect`），所以读样式文本 —— 断言的是"这条规则存在"，
// 而不是某处恰好出现了同样的数值。
const selectRule = ruleOf('templateSelect')
check('下拉有宽度约束（选项变长不会把底部按钮挤下去）',
  /max-width:\s*260px/.test(selectRule), selectRule)

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
const { copyText } = await import(pathToFileURL(resolve(SHARED, 'ui', 'clipboard.ts')).href)
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

// ---- 8) 提示词库弹窗 ----
//
// 这一节渲染的是**另一个组件**（LibraryPanel / LibraryTrigger）：拆分后两个组件各有自己的
// store 与动作，测试也必须分别驱动 —— 用结构化组件的实例去驱动它会什么都测不到。
const libraryOk = () => {
  const out = libraryPanel()
  return out.error === null ? out.html : `render-failed: ${String(out.error)}`
}
const libraryFailed = html => html.startsWith('render-failed')
//
// 检索走宿主代发的同源路由，SSR 里不会真发请求；这里用 store 驱动界面状态，覆盖四种渲染：
// 入口按钮、列表（含失败态）、详情，以及「两个组件互不干涉」。网络层的行为由工具套断言。
instance.actions.close()
const triggerHtml = (() => {
  const out = libraryTrigger()
  return out.error === null ? out.html : `render-failed: ${String(out.error)}`
})()
check('入口有「提示词库」按钮',
  !libraryFailed(triggerHtml)
  && triggerHtml.includes('data-structured-prompt-library-trigger')
  && triggerHtml.includes('提示词库'),
  triggerHtml.slice(0, 200))

libraryInstance.actions.open()
const libraryOpen = libraryOk()
check('打开检索弹窗',
  !libraryFailed(libraryOpen) && libraryOpen.includes('data-structured-prompt-library'),
  libraryOpen.slice(0, 160))
// 拆分后两个组件**各管各的**：检索弹窗里不该出现表单弹窗的任何标记；而"打开一个不会改动另一个
// 组件的开关"才是有意义的证据 —— 只断言前者是恒真的（库弹窗本来就不含表单的标记）。
check('检索弹窗只渲染自己的内容（不含表单弹窗的标记）',
  !libraryFailed(libraryOpen)
  && !libraryOpen.includes('data-structured-prompt-modal')
  && !libraryOpen.includes('结构化输入任务'),
  libraryOpen.slice(0, 160))
check('检索弹窗根带共享属性 data-dsh-prompt-panel',
  !libraryFailed(libraryOpen) && libraryOpen.includes('data-dsh-prompt-panel'))
check('两个组件的开关互不影响（各自一个 store）',
  libraryInstance.getSnapshot().active === true && instance.getSnapshot().active === false,
  `library.active=${String(libraryInstance.getSnapshot().active)}`
  + ` form.active=${String(instance.getSnapshot().active)}`)
check('检索弹窗有搜索框与检索按钮',
  libraryOpen.includes('aria-label="检索提示词"') && libraryOpen.includes('>检索<'))
check('未检索时给出用法提示', libraryOpen.includes('留空则列出最新的一批'))
check('底部说明请求由宿主代发', libraryOpen.includes('请求由宿主代发'))

// 假数据用**上游检索端点的真实字段形状**：`/api/prompts/search` 的条目只有
// id/title/slug/author，没有 description（实测）—— 用带 description 的假数据会掩盖
// "真实界面里列表只有标题与作者"这个事实。
libraryInstance.actions.patch({
  status: 'ready',
  total: 12,
  items: [
    { id: 'a1', title: 'Code Review Expert', description: '', author: 'alice' },
    { id: 'a2', title: '文章大纲', description: '', author: '' },
  ],
})
const listed = libraryOk()
check('列表渲染标题与作者（上游检索端点不给描述）',
  !libraryFailed(listed) && listed.includes('Code Review Expert') && listed.includes('@alice'),
  listed.slice(0, 160))
check('无描述的条目不留下 undefined 字样',
  !libraryFailed(listed) && !listed.includes('undefined'))
// 容错路径：上游哪天给了 description，界面照样渲染（`mapItem` 保留该字段）。
libraryInstance.actions.patch({
  status: 'ready',
  items: [{ id: 'a1', title: 'T', description: '上游给了描述', author: '' }],
})
const described = libraryOk()
check('上游给了描述时也渲染（mapItem 保留该字段）',
  !libraryFailed(described) && described.includes('上游给了描述'), described.slice(0, 160))
check('列表显示总数与显示条数', listed.includes('共 12 条') && listed.includes('显示前 2 条'))
check('条目带可定位的锚点', listed.includes('data-library-item="a1"'))

// 来源标注跟着响应里的 source 走（宿主按配置回填），不是写死在客户端。
libraryInstance.actions.patch({ status: 'ready', source: 'prompts.chat' })
const sourced = libraryOk()
check('列表底部标注数据来源（来自响应，不是写死）',
  !libraryFailed(sourced) && sourced.includes('来源：prompts.chat'), sourced.slice(0, 200))
libraryInstance.actions.patch({ source: 'self.example' })
const selfSourced = libraryOk()
check('来源名随响应变化（自托管时不显示默认域名）',
  !libraryFailed(selfSourced) && !selfSourced.includes('prompts.chat'), selfSourced.slice(0, 200))

libraryInstance.actions.patch({ status: 'failed', failure: '上游 503', items: [], total: 0 })
const failedHtml = libraryOk()
check('失败态显示说明',
  !libraryFailed(failedHtml) && failedHtml.includes('上游 503'), failedHtml.slice(0, 160))

libraryInstance.actions.patch({
  status: 'ready',
  selectedId: 'a1',
  detailStatus: 'ready',
  detail: {
    id: 'a1', title: 'Code Review Expert', description: '', author: 'alice', content: 'PREVIEW BODY',
  },
})
const libraryDetail = libraryOk()
check('详情视图渲染原文',
  !libraryFailed(libraryDetail)
  && libraryDetail.includes('data-library-content') && libraryDetail.includes('PREVIEW BODY'),
  libraryDetail.slice(0, 160))
check('详情视图说明原文未经整理', libraryDetail.includes('未经本插件整理'))
check('详情视图提供复制与发送',
  libraryDetail.includes('>复制<') && libraryDetail.includes('发送原始提示词'))
check('详情视图可返回列表', libraryDetail.includes('← 返回'))
// "发送的就是检索到的原文"是这条路径的核心承诺。SSR 点不了按钮，但可以证明**界面显示的
// 原文与 `detail.content` 逐字一致** —— 发送用的正是同一个字段。
const shownContent = (/<pre[^>]*data-library-content[^>]*>([\s\S]*?)<\/pre>/.exec(libraryDetail) ?? [])[1] ?? ''
check('详情视图里的原文与 detail.content 逐字一致',
  shownContent === 'PREVIEW BODY', shownContent.slice(0, 80))
// 上游地址是宿主侧配置（可指向自托管实例），界面文案不该写死默认域名。
check('界面不写死上游域名（可指向自托管实例）',
  !libraryFailed(libraryDetail) && !libraryFailed(libraryOpen)
  && !libraryDetail.includes('prompts.chat') && !libraryOpen.includes('prompts.chat'))
// 检索到的原文**不进入构建器**：详情视图里不该出现表单产物（两条产出路径互不干涉）。
check('详情视图不渲染提示词成稿（两条产出路径互不干涉）',
  !libraryFailed(libraryDetail) && !libraryDetail.includes('# 硬性规则'))

// 「转化为表单」是**主动动作**：只有用户点它时，原文才会经模型变成字段补丁交给表单。
check('详情视图提供「转化为表单」入口（转化是主动动作，不是自动）',
  !libraryFailed(libraryDetail) && libraryDetail.includes('转化为表单'))

libraryInstance.actions.close()
check('关闭检索弹窗后不占空间', panel().html === '')

// ---- 9) 类名与定位基准 ----
//
// 这一节守的是本批（样式迁进 CSS Modules）最容易静默出错的两处，两处都先经副本突变证明过
// "没有它们时测试不说话"：
//   1. 类名 typo —— 离线 CSS 桩对任意 key 都返回 `css-<key>`，所以 `s.modalTypo` 也能渲染出
//      class，看起来完全正常；
//   2. 定位基准被改回视口 —— 那正是使用者反馈的那个 bug，而真实布局离线测不了。

// 1) 组件用到的每个类名都必须真的在样式文件里存在。
const allHtml = `${modal.html}${toolsOpen.html}${libraryOpen}${libraryDetail}`
const classTokens = [...new Set(
  [...allHtml.matchAll(/class="([^"]*)"/g)]
    .flatMap(match => (match[1] ?? '').split(/\s+/))
    .filter(token => token.startsWith('css-'))
    .map(token => token.slice('css-'.length)),
)]
const missingClasses = classTokens.filter(name => !new RegExp(`\\.${name}\\s*[,{]`).test(moduleCssText))
check('组件用到的类名都在 panel.module.css 里存在（挡住类名 typo）',
  classTokens.length > 0 && missingClasses.length === 0,
  `共 ${classTokens.length} 个类，缺失：${missingClasses.join(', ') || '(无)'}`)

// 2) 定位基准是「比视口窄的那一列」，而不是视口。静态读源码：真实布局测不了，但"基准的判据"
//    这一行可以被守住（把它换成 documentElement 就是退回那个 bug，实测零红）。
//    第一版修复只取了一层 `parentElement`，而槽位包装层可能仍是整宽容器 —— 那样测出来等于
//    视口宽、弹窗照旧居中，界面上毫无变化。所以这里同时守住"会向上找"。
const frameSource = readFileSync(resolve(SHARED, 'ui', 'use-dialog-frame.ts'), 'utf8')
check('定位基准是「比视口窄的那一列」（不是视口本身，也不是整宽的包装层）',
  /clientWidth < viewport/.test(frameSource) && !/documentElement/.test(frameSource))
check('基准会向上找（槽位包装层数随版本变，只看一层会静默失效）',
  /node = node\.parentElement/.test(frameSource))
check('列尺寸无效时不写定位（避免把遮罩压成不可见）',
  /width > 0/.test(frameSource) && /height > 0/.test(frameSource))
check('rect → 遮罩样式的映射正确（纯函数，可离线断言）', (() => {
  const frame = frameFromRect({ left: 120, width: 800, height: 600 })
  return frame.left === 120 && frame.width === 800 && frame.right === 'auto' && frame.top === undefined
})())
check('列尺寸为 0 时退回 CSS 的 inset: 0（不写定位）',
  Object.keys(frameFromRect({ left: 0, width: 0, height: 0 })).length === 0,
  JSON.stringify(frameFromRect({ left: 0, width: 0, height: 0 })))

// ---- 11) 自动填充的界面状态 ----
//
// 这一节守状态机：审查用突变实测，删掉"进行中不发"零红 —— 所以至少要覆盖"running 时按钮
// 禁用且文案变化"，以及失败态/成功态各自显示什么、旧错误会不会残留。

instance.actions.open()
instance.actions.patchAssist({ brief: '帮我写个告警排查的提示词', status: 'idle', error: '', warnings: [] })
const assistIdle = okHtml()
check('自动填充行渲染出输入框与按钮（带状态锚点）',
  !renderFailed(assistIdle)
  && assistIdle.includes('data-assist-status="idle"')
  && assistIdle.includes('aria-label="一句话需求（自动填充）"'),
  assistIdle.slice(0, 200))

instance.actions.patchAssist({ status: 'running' })
const assistRunning = okHtml()
check('进行中：按钮禁用、文案变「生成中…」、状态锚点跟随', (() => {
  if (renderFailed(assistRunning)) return false
  const anchor = /<div[^>]*data-assist-status="([a-z]+)"/.exec(assistRunning)
  const disabled = /<button[^>]*disabled[^>]*>[^<]*生成中…/.test(assistRunning)
  return anchor?.[1] === 'running' && disabled
})(), assistRunning.slice(0, 300))

instance.actions.patchAssist({ status: 'failed', error: '取不到当前会话，无法启动子代理' })
check('失败态把原因显示出来', okHtml().includes('取不到当前会话'))

instance.actions.patchAssist({
  status: 'done', error: '', warnings: ['忽略字段 rules：取值不符合 string[]'],
})
const assistDone = okHtml()
check('成功态显示丢弃条数与原因，且旧错误不再残留',
  !renderFailed(assistDone)
  && assistDone.includes('丢弃了 1 处不合法内容')
  && assistDone.includes('忽略字段 rules')
  && !assistDone.includes('取不到当前会话'),
  assistDone.slice(0, 300))

// ---- 12) mergeForm 语义（上一轮那条数据丢失的回归守护）----
//
// 审查实测：把 `mergeForm` 改成 `completeForm`（= 清空未给的键）**八套零红**。那条阻断是静默
// 数据丢失（用户填 5 个字段、模型只回 2 个 → 另外 3 个被清空），修完了却没有回归测试。

instance.actions.reset()
instance.actions.setField('role', '保留的身份')
instance.actions.setField('goal', '保留的目标')
instance.actions.mergeForm({ background: '只补这一个' })
const mergedForm = instance.getSnapshot().form
check('mergeForm 只覆盖给定的键，其它已填字段保留',
  mergedForm.role === '保留的身份' && mergedForm.goal === '保留的目标'
  && mergedForm.background === '只补这一个',
  JSON.stringify({ role: mergedForm.role, goal: mergedForm.goal, bg: mergedForm.background }))

// 对照断言：setForm 是**整表替换**。两个动作语义必须不同，否则 mergeForm 就没有存在意义 ——
// 这条同时也挡住"把 mergeForm 实现成 completeForm"的退化。
instance.actions.setForm({ role: '只剩这个' })
const replacedForm = instance.getSnapshot().form
check('setForm 是整表替换（未给的字段被清空），与 mergeForm 语义不同',
  replacedForm.role === '只剩这个' && replacedForm.goal === '',
  JSON.stringify({ role: replacedForm.role, goal: replacedForm.goal }))

// 静态断言：自动填充消费补丁的那一行必须用 mergeForm
//（审查实测：换回 setForm 八套零红 —— 那正是数据丢失的写法）。
const panelSource = readFileSync(
  resolve(CLIENT, '..', 'components', 'structured', 'client', 'ui', 'Panel.tsx'),
  'utf8',
)
check('自动填充消费补丁用 mergeForm（不是 setForm）',
  /actions\.mergeForm\(result\.value\.patch\)/.test(panelSource)
  && !/actions\.setForm\(result\.value\.patch\)/.test(panelSource))

if (failed > 0) {
  console.error(`\n${failed} 项渲染测试未通过。`)
  process.exit(1)
}
console.log('\n全部渲染测试通过。')
