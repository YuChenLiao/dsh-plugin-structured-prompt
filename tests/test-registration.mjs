/**
 * 插件注册契约测试（不需要 DSH 运行时）。
 *
 * 为什么需要它：渲染测试直接给组件喂 `useStore`，因此**绕过了框架的注入**。
 * 而 `useStore`/`actions` 并不是标准 props —— 渲染器只在注册声明了 `store` 座位
 * 时才注入它们。漏声明会让组件拿到 `undefined`、渲染时抛错、条目被隔离失效
 * （表现为"按钮消失"）。这条契约只能本文件这样在注册层校验。
 *
 * 用法：node --import tsx --import ./tools/lib/loader-hook.mjs tests/test-registration.mjs
 */
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client')

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : `\n      ${detail}`}`)
  if (!ok) failed += 1
}

/** 构造只记录调用的假 ctx，覆盖 apply 用到的全部服务。 */
function makeCtx() {
  const registrations = []
  const injected = []
  const effects = []
  const sent = []
  // 会话作用域上下文：真实类型是 AgentContext，发送走它的 get('conversation')。
  const conversation = {
    send: async (text) => { sent.push(text) },
  }
  const scoped = {
    get: (name) => (name === 'conversation' ? conversation : undefined),
  }
  const ctx = {
    get: (name) => {
      if (name === 'sessions') return { scope: (id) => (id === 'session-abc' ? scoped : undefined) }
      return undefined
    },
    effect: (factory, label) => {
      effects.push(label)
      const disposer = factory()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    slots: {
      inject: (name, callback) => {
        injected.push(name)
        callback()
      },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, registrations, injected, effects, sent }
}

/** 最小 document 桩：apply 会注入一个样式标签。 */
function installDocumentStub() {
  const head = {
    children: [],
    appendChild(node) { this.children.push(node) },
  }
  globalThis.document = {
    head,
    querySelector: () => null,
    createElement: () => ({ dataset: {}, style: {}, textContent: '' }),
  }
  return head
}

installDocumentStub()
const mod = await import(pathToFileURL(resolve(CLIENT, 'index.ts')).href)

// ---- 1) apply() 全程不抛错 ----

const bench = makeCtx()
let applyError = null
try {
  mod.apply(bench.ctx)
} catch (error) {
  applyError = error
}
check('apply() 不抛错', applyError === null, applyError === null ? '' : String(applyError))
check('apply() 注册了六个槽位（结构化：两个按钮 + 弹窗 + tab 主体；库两条）',
  bench.registrations.length === 6, `实际 ${bench.registrations.length}`)
check('apply() 处理了六个 inject 目标（工具 + 三条路由 + tab 主体各自的 connection 作用域）',
  bench.injected.length === 6, bench.injected.join(', '))
// 样式注入现在由**构建产物**承担：`tools/lib/build.mjs` 的 CSS 插件把 `.css` 编译成幂等的注入
// 模块（`style[data-plugin-css]` 去重），在 bundle 执行时自动完成。所以 apply 不该再碰 document ——
// 否则同一份样式会被注入两次。这条断言因此反过来写。
check('apply() 不再自己注入样式（注入由构建产物承担）',
  bench.effects.every(name => !String(name).includes('style')), bench.effects.join(' | '))

// ---- 2) 关键契约：每个注册都声明 store（否则 useStore 为 undefined）----

// 只有需要共享状态的注册才声明 store：「任务扩写」自管本地状态，草稿读写走宿主给的标准
// props（`useInput` / `inputActions`），所以它不该有 store —— 声明了等于挂一个无人使用的句柄。
for (const { options } of bench.registrations) {
  if (options.id === 'structured-prompt-task') {
    check(`注册「${options.name}」(${options.id}) 不声明 store（用宿主的标准 props）`,
      options.store === undefined)
    continue
  }
  check(`注册「${options.name}」(${options.id}) 声明了 store 座位`,
    options.store !== undefined && typeof options.store.create === 'function')
}
// 拆分后**每个组件各有自己的 store 句柄**：同一组件的每条注册必须共用它（否则实例不共享、
// 入口驱动不了表单），两个组件之间必须是**不同**句柄（否则状态又耦合回去）。
const byId = (id) => bench.registrations.filter(entry => entry.options.id === id)
const structuredLeft = byId('structured-prompt').find(entry => entry.options.name === 'conversation.input.left')
const structuredDock = byId('structured-prompt').find(entry => entry.options.name === 'conversation.input.dock')
const structuredTab = bench.registrations.find(entry => entry.options.name === 'sidebar.right.pane.tab')
const libraryLeft = byId('prompt-library').find(entry => entry.options.name === 'conversation.input.left')
const libraryDock = byId('prompt-library').find(entry => entry.options.name === 'conversation.input.dock')
check('注册分成三组：结构化（入口 + 弹窗 + tab 主体）、任务扩写（仅入口）、提示词库（入口 + 弹窗）',
  byId('structured-prompt').length === 2
  && structuredTab !== undefined     // tab 主体不带 `id`（它的身份是 `key`），单独数
  && byId('structured-prompt-task').length === 1
  && byId('prompt-library').length === 2,
  `structured×${byId('structured-prompt').length}, tab×${structuredTab === undefined ? 0 : 1}, task×${byId('structured-prompt-task').length}, library×${byId('prompt-library').length}`)
check('结构化的三条注册（入口 / 弹窗 / tab 主体）共用同一个 store 句柄',
  structuredLeft?.options.store !== undefined
  && structuredLeft.options.store === structuredDock?.options.store
  && structuredLeft.options.store === structuredTab?.options.store)
check('两个组件用的是不同句柄（状态不耦合）',
  libraryLeft?.options.store !== undefined
  && libraryLeft.options.store !== structuredLeft?.options.store)
// 句柄的**行为契约**：只比"句柄相同/不同"抓不到"把库组件的 store 换成结构化的"—— 那两者都是
// 合法句柄、句柄也仍然不同，只是绑错了（实测这种变异在运行期的其它断言里 0 条红）。所以按组件
// 断言各自动作表里该有的动作。注意动作表在**实例**上（`handle.create(sessionId).actions`）。
const actionsOf = entry => Object.keys(entry.options.store.create('probe').actions ?? {})
check('结构化组件的 store 提供表单动作（setForm / setField / addTool）',
  ['setForm', 'setField', 'addTool'].every(name => actionsOf(structuredLeft).includes(name)),
  JSON.stringify(actionsOf(structuredLeft)))
check('提示词库组件的 store 提供检索动作（patch / backToList）',
  ['patch', 'backToList', 'open', 'close'].every(name => actionsOf(libraryLeft).includes(name)),
  JSON.stringify(actionsOf(libraryLeft)))
// 「任务扩写」只占入口槽位（没有外壳），所以只对有 store 的组检查槽位组成。
check('有状态的两组各自占「入口 + 弹窗」，结构化另有 tab 主体这一条',
  new Set([structuredLeft, structuredDock, structuredTab].map(entry => entry?.options.name)).size === 3
  && new Set([libraryLeft, libraryDock].map(entry => entry?.options.name)).size === 2)

// ---- 3) 注册表与预期一一对应 ----

const docks = [structuredDock, libraryDock].filter(entry => entry !== undefined)
check('两个带状态的组件都注册了弹窗挂载点', docks.length === 2)
check('入口与弹窗使用不同组件',
  structuredLeft?.component !== structuredDock?.component
  && libraryLeft?.component !== libraryDock?.component)

// ---- 3b) 发送链路：每个组件的 inject 面都把内容投进该会话 ----

for (const dock of docks) {
  const id = String(dock?.options.id)
  const dockInject = dock?.options.inject
  check(`「${id}」的弹窗注册带 inject 面（发送能力）`, typeof dockInject === 'function')
  const face = dockInject?.('session-abc')
  check(`「${id}」的 inject 面暴露 onSend`, typeof face?.onSend === 'function')
  face?.onSend(`来自 ${id} 的正文`)
}
// conversation.send 是异步的：等一轮微任务后检查投递。
await Promise.resolve()
await Promise.resolve()
check('onSend 把内容交给会话的 conversation.send',
  bench.sent.length === 2 && bench.sent.every(text => String(text).startsWith('来自 ')),
  JSON.stringify(bench.sent))
// 会话取不到时不应抛错，只记录日志（避免拖垮整个 apply）。
const missingFace = docks[0]?.options.inject?.('session-not-found')
let sendError = null
try {
  missingFace?.onSend('成稿正文')
} catch (error) {
  sendError = error
}
check('未知会话下发送不抛错', sendError === null, sendError === null ? '' : String(sendError))

// ---- 3c) 右侧栏 tab 通路：顺序无关 ----
//
// 第一版在 apply 期用 `ctx.get` 探测一次就定生死，真机结果是"出来的还是弹窗"：服务提供方可能
// 后于本插件 apply，探不到就静默降级了。所以这一节的重心是**三种时序**都要覆盖 ——
// 早到（立即接）、晚到（靠 `ctx.inject` 接）、始终不在（退回弹窗并说明原因），再加上两种
// 运行期故障（注册被拒 / openTab 抛错）。只测"有服务"会让静默降级再次复活。

/**
 * 构造带侧栏后端服务的假 ctx。
 * @param {object} [options] - 时序与故障开关。
 * @param {boolean} [options.attached] - 原生右侧栏是否在 apply 期就可见（默认 `true`）。
 * @param {boolean} [options.better] - `dsh-better-sidebar` 是否可用（默认 `false`）。
 * @param {boolean} [options.failBetter] - 让 better-sidebar 的 `registerTab` 抛错。
 * @param {boolean} [options.failBetterOpen] - 让 better-sidebar 的 `openTab` 抛错。
 * @param {boolean} [options.betterDisabled] - 让 `isTabEnabled` 返回 false（用户在侧栏设置里关了它）。
 * @param {boolean} [options.betterUnregistered] - 让 `getTab` 返回 undefined（描述符不在注册表）。
 * @param {boolean} [options.betterNoSession] - 让侧栏快照里没有激活会话（`open` 又没带会话时无解）。
 * @param {boolean} [options.failRegister] - 让原生 `register` 抛错（类型被服务拒绝）。
 * @param {boolean} [options.failOpen] - 让原生 `openTab` 抛错（kind 没进注册表）。
 * @param {boolean} [options.rightMissing] - 只有 `sidebarRightTabs`、没有 `sidebarRight`。
 */
function makeSidebarCtx(options = {}) {
  const bench = makeCtx()
  const state = { attached: options.attached !== false, better: options.better === true }
  const tabTypes = []
  const opened = []
  const waits = []
  const betterTabs = []
  const betterOpens = []
  const released = []
  const baseGet = bench.ctx.get
  /**
   * 假服务**必须**按实例缓存：宿主那边是"每个激活一份"的单例，接入链正是靠实例身份判断
   * "要不要重新注册"。每次 `get` 都造新对象的话，真实世界里"服务被替换"的语义就被抹掉了。
   * @type {object | undefined}
   */
  let built
  /**
   * 构造（或取回）三个假服务。
   * @returns 三个假服务。
   */
  const services = () => {
    built ??= {
      sidebarRightTabs: {
        register: (definition) => {
          if (options.failRegister === true) throw new Error('sidebarRightTabs: id already registered')
          tabTypes.push(definition)
          return () => { released.push(definition.id) }
        },
      },
      sidebarRight: {
        openTab: (kind) => {
          if (options.failOpen === true) throw new Error(`sidebarRight: page type "${kind}" is not registered`)
          opened.push(kind)
        },
        active: () => (options.nativeOpenTab === undefined ? undefined : { id: 'native-tab-1', kind: options.nativeOpenTab }),
        close: (tabId) => { released.push(tabId) },
      },
      betterSidebar: {
        registerTab: (descriptor) => {
          if (options.failBetter === true) throw new Error('betterSidebar: duplicate tab id')
          betterTabs.push(descriptor)
          return () => { released.push(descriptor.id) }
        },
        openTab: (seed, scope) => {
          if (options.failBetterOpen === true) throw new Error('betterSidebar: no session scope')
          betterOpens.push({ seed, scope })
        },
        isTabEnabled: () => options.betterDisabled !== true,
        getTab: () => (options.betterUnregistered === true ? undefined : { id: 'dsh-plugin-structured-prompt:form' }),
        getSnapshot: () => (options.betterNoSession === true ? {} : { sessionId: 'session-abc' }),
      },
    }
    return built
  }
  bench.ctx.get = (name) => {
    if (name === 'betterSidebar' && state.better) return services().betterSidebar
    if (name === 'sidebarRight' && options.rightMissing === true) return undefined
    if ((name === 'sidebarRightTabs' || name === 'sidebarRight') && state.attached) return services()[name]
    return baseGet(name)
  }
  bench.ctx.inject = (deps, callback) => { waits.push({ deps: [...deps], callback }) }
  return {
    ...bench,
    options,
    tabTypes,
    opened,
    waits,
    betterTabs,
    betterOpens,
    released,
    /** 让原生服务在 apply 之后才出现（模拟提供方晚于本插件 apply）。 */
    provide() {
      state.attached = true
      const keep = []
      for (const wait of waits.splice(0)) {
        if (wait.deps.includes('sidebarRightTabs')) wait.callback(bench.ctx)
        else keep.push(wait)
      }
      waits.push(...keep)
    },
    /** 换一批服务实例（模拟插件重载：旧注册表随旧 fiber 消失，服务对象也换了）。 */
    replaceBetter() {
      built = undefined
      state.better = true
      const keep = []
      for (const wait of waits.splice(0)) {
        if (wait.deps.includes('betterSidebar')) wait.callback(bench.ctx)
        else keep.push(wait)
      }
      waits.push(...keep)
    },
    /** 让 better-sidebar 事后才出现（模拟它的 apply 晚于本插件）。 */
    provideBetter() {
      state.better = true
      const keep = []
      for (const wait of waits.splice(0)) {
        if (wait.deps.includes('betterSidebar')) wait.callback(bench.ctx)
        else keep.push(wait)
      }
      waits.push(...keep)
    },
  }
}

/**
 * 从注册表里取出三个 inject 面。
 * @param {object} which - `makeSidebarCtx` 的返回值。
 * @returns 入口的 open / 弹窗的面 / tab 主体那条注册。
 */
function facesOf(which) {
  const find = name => which.registrations.find(entry => entry.options.name === name
    && (name === 'sidebar.right.pane.tab' || entry.options.id === 'structured-prompt'))
  return {
    left: find('conversation.input.left'),
    open: find('conversation.input.left')?.options.inject?.('session-abc')?.open,
    dock: find('conversation.input.dock')?.options.inject?.('session-abc'),
    tab: find('sidebar.right.pane.tab'),
  }
}

// (a) 服务早到：apply 期就接通。
const early = makeSidebarCtx()
mod.apply(early.ctx)
const earlyFaces = facesOf(early)
check('服务早到：apply 期就注册了 tab 类型（不必等打开）',
  early.tabTypes.length === 1, `实际 ${early.tabTypes.length}`)
const earlyOpened = earlyFaces.open?.()
check('服务早到：入口的 open 立刻返回 true（走 tab，不走弹窗）',
  earlyOpened === true && early.opened[0] === early.tabTypes[0]?.kind,
  `${String(earlyOpened)} / ${JSON.stringify(early.opened)}`)
check('服务早到：不显示降级说明', earlyFaces.dock?.degradeNote?.() === undefined,
  String(earlyFaces.dock?.degradeNote?.()))
// better-sidebar 那条等待是**故意保留**的：它后到时要能顶掉原生后端（见 3d）。
check('接通后只保留 better-sidebar 的升级等待（不再等原生）',
  early.waits.length === 1 && early.waits[0].deps.includes('betterSidebar'),
  JSON.stringify(early.waits.map(wait => wait.deps)))

// (b) 服务晚到：第一版就是在这里静默降级的。apply 期不猜、不抛错，等它出现再接。
const late = makeSidebarCtx({ attached: false })
mod.apply(late.ctx)
const lateFaces = facesOf(late)
check('服务晚到：apply 期没注册类型（不猜、不抛错）', late.tabTypes.length === 0)
check('服务晚到：apply 期挂上了两条依赖等待（better-sidebar 一条、原生一条）',
  late.waits.length === 2
  && late.waits.every(wait => wait.deps.includes('betterSidebar') || wait.deps.includes('sidebarRightTabs')),
  JSON.stringify(late.waits.map(wait => wait.deps)))
check('服务晚到：依赖就绪后补注册类型并接通',
  (() => { late.provide(); return late.tabTypes.length === 1 && lateFaces.open?.() === true })(),
  `${late.tabTypes.length} / ${JSON.stringify(late.opened)}`)
check('服务晚到并接通后：降级说明消失', lateFaces.dock?.degradeNote?.() === undefined,
  String(lateFaces.dock?.degradeNote?.()))

// (b2) 服务晚到 + 上下文没有 `ctx.inject`（老实现）：只剩"打开那一刻再探"这一条。它必须成立，
// 否则老宿主上接通的唯一机会就没了 —— 这条也是第一版真正的病根：探测失败后入口干脆没有 open。
const lateNoInject = makeSidebarCtx({ attached: false })
delete lateNoInject.ctx.inject
mod.apply(lateNoInject.ctx)
const lateNoInjectFaces = facesOf(lateNoInject)
check('没有 ctx.inject 时：apply 期接不上（不抛错）', lateNoInject.tabTypes.length === 0)
check('没有 ctx.inject 时：打开那一刻探测并接通',
  (() => {
    lateNoInject.provide()
    // 顺序要紧：类型是**打开那一刻**才注册的，所以先 open 再数。
    const openedOk = lateNoInjectFaces.open?.() === true
    return openedOk && lateNoInject.tabTypes.length === 1
  })(),
  `${lateNoInject.tabTypes.length} / ${JSON.stringify(lateNoInject.opened)}`)

// (c) 服务从头到尾不在：旧宿主的正常形态 —— 退回弹窗，并把原因写在弹窗上。
const absent = makeSidebarCtx({ attached: false })
mod.apply(absent.ctx)
const absentFaces = facesOf(absent)
check('没有该能力：入口仍然注入 open（返回 false，而不是"没有通路"）—— 否则第一版的静默降级会复活',
  typeof absentFaces.open === 'function')
check('没有该能力：open() 返回 false（调用方退回弹窗）', absentFaces.open?.() === false)
check('没有该能力：降级说明写明缺的是 sidebarRightTabs',
  String(absentFaces.dock?.degradeNote?.()).includes('sidebarRightTabs'),
  String(absentFaces.dock?.degradeNote?.()))
check('没有该能力：tab 主体仍然注册（槽位不存在时 inject 不回调，不报错）',
  absentFaces.tab !== undefined)

// (d) 运行期故障：注册被服务拒绝 / openTab 抛错。都要收敛成 `false` + 原因，而不是抛给点击处理器。
const rejected = makeSidebarCtx({ failRegister: true })
let registerError = null
try {
  mod.apply(rejected.ctx)
} catch (error) {
  registerError = error
}
const rejectedFaces = facesOf(rejected)
check('注册被拒：apply 不抛错', registerError === null, String(registerError))
check('注册被拒：open() 返回 false', rejectedFaces.open?.() === false)
check('注册被拒：降级说明写的是「注册失败」',
  String(rejectedFaces.dock?.degradeNote?.()).includes('注册失败'),
  String(rejectedFaces.dock?.degradeNote?.()))

const broken = makeSidebarCtx({ failOpen: true })
mod.apply(broken.ctx)
const brokenFaces = facesOf(broken)
let openError = null
let openedOk = null
try {
  openedOk = brokenFaces.open?.()
} catch (error) {
  openError = error
}
check('openTab 抛错：不把错误抛给界面', openError === null, String(openError))
check('openTab 抛错：open() 返回 false（调用方退回弹窗）', openedOk === false, String(openedOk))
check('openTab 抛错：降级说明写的是「已退回弹窗」',
  String(brokenFaces.dock?.degradeNote?.()).includes('退回弹窗'),
  String(brokenFaces.dock?.degradeNote?.()))

// ---- 3d) 后端优先级：dsh-better-sidebar > 宿主原生右侧栏 ----

const both = makeSidebarCtx({ better: true })
mod.apply(both.ctx)
const bothFaces = facesOf(both)
check('两者都在：选 dsh-better-sidebar（不走原生 openTab）',
  bothFaces.open?.('session-abc') === true && both.betterOpens.length === 1 && both.opened.length === 0,
  `better=${both.betterOpens.length} native=${both.opened.length}`)
const [descriptor] = both.betterTabs
check('描述符带 id / title / single / component（重复打开只聚焦）',
  descriptor?.id === 'dsh-plugin-structured-prompt:form'
  && typeof descriptor?.title === 'function'
  && descriptor?.single === true
  && typeof descriptor?.component === 'function',
  JSON.stringify({ id: descriptor?.id, single: descriptor?.single }))
check('描述符的 component 带 sender（渲染得出 tab 主体）',
  (() => {
    const tree = descriptor.component({ scope: { sessionId: 'session-abc' } })
    return tree !== null && typeof tree === 'object' && tree.props?.sessionId === 'session-abc'
  })())
check('open 把会话带进 scope（better-sidebar 靠它定位 tab）',
  both.betterOpens.at(-1)?.scope?.sessionId === 'session-abc'
  && both.betterOpens.at(-1)?.seed?.type === descriptor?.id,
  JSON.stringify(both.betterOpens.at(-1)))
check('两者都在时不注册原生类型（否则同一份表单在两套 tab 里各出现一次）',
  both.tabTypes.length === 0)

// better-sidebar 晚到：先按原生接上，它一出现就顶掉原生。
const upgrade = makeSidebarCtx({ better: false })
mod.apply(upgrade.ctx)
const upgradeFaces = facesOf(upgrade)
check('没有 better-sidebar：用宿主原生右侧栏',
  upgradeFaces.open?.() === true && upgrade.tabTypes.length === 1 && upgrade.opened.length === 1)
upgrade.provideBetter()
check('better-sidebar 后到：改用它，并撤掉已挂上的原生类型',
  upgrade.betterTabs.length === 1
  && upgrade.released.includes('dsh-plugin-structured-prompt/structured-prompt-form')
  && upgradeFaces.open?.('session-abc') === true
  && upgrade.betterOpens.length === 1,
  `better=${upgrade.betterTabs.length} released=${JSON.stringify(upgrade.released)}`)

// better-sidebar 注册被拒：退回原生，而不是把错误抛给界面。
const rejectedBetter = makeSidebarCtx({ better: true, failBetter: true })
mod.apply(rejectedBetter.ctx)
const rejectedBetterFaces = facesOf(rejectedBetter)
check('better-sidebar 注册被拒：退回原生右侧栏',
  rejectedBetterFaces.open?.() === true && rejectedBetter.tabTypes.length === 1 && rejectedBetter.opened.length === 1)

// better-sidebar 打开抛错：open 返回 false + 原因，而不是按了没反应。
const brokenBetter = makeSidebarCtx({ better: true, failBetterOpen: true })
mod.apply(brokenBetter.ctx)
const brokenBetterFaces = facesOf(brokenBetter)
check('better-sidebar 打开抛错：open() 返回 false', brokenBetterFaces.open?.('session-abc') === false)
check('better-sidebar 打开抛错：降级说明写的是「已退回弹窗」',
  String(brokenBetterFaces.dock?.degradeNote?.()).includes('退回弹窗'),
  String(brokenBetterFaces.dock?.degradeNote?.()))

// ---- 3d-2) better-sidebar 的拒绝路径与实例替换（审查抓到的两条死键）----
//
// `openTab` 的契约里最要命的一条：类型被用户在侧栏设置里关掉、描述符不在注册表、没有目标会话时，
// 它**只 return、不抛错**。不先自证，`open()` 就会返回 true —— 入口不退回弹窗，用户按了没反应。
// 第一版正是这样：断言只覆盖"抛错"这一条，静默拒绝零红。

const disabled = makeSidebarCtx({ better: true, betterDisabled: true })
mod.apply(disabled.ctx)
const disabledFaces = facesOf(disabled)
check('better-sidebar 类型被禁用：open() 返回 false（不装成已打开）',
  disabledFaces.open?.('session-abc') === false && disabled.betterOpens.length === 0,
  `open=${String(disabledFaces.open?.('session-abc'))} opens=${disabled.betterOpens.length}`)
check('better-sidebar 类型被禁用：降级说明写明原因',
  String(disabledFaces.dock?.degradeNote?.()).includes('禁用'),
  String(disabledFaces.dock?.degradeNote?.()))

const unregistered = makeSidebarCtx({ better: true, betterUnregistered: true })
mod.apply(unregistered.ctx)
const unregisteredFaces = facesOf(unregistered)
check('描述符不在注册表：open() 返回 false',
  unregisteredFaces.open?.('session-abc') === false && unregistered.betterOpens.length === 0)
check('描述符不在注册表：降级说明写明原因',
  String(unregisteredFaces.dock?.degradeNote?.()).includes('注册表'),
  String(unregisteredFaces.dock?.degradeNote?.()))

const noSession = makeSidebarCtx({ better: true, betterNoSession: true })
mod.apply(noSession.ctx)
const noSessionFaces = facesOf(noSession)
check('没有会话作用域：open() 不带会话时返回 false（而不是当成功）',
  noSessionFaces.open?.() === false && noSession.betterOpens.length === 0)
check('没有会话作用域：降级说明写明原因',
  String(noSessionFaces.dock?.degradeNote?.()).includes('会话'),
  String(noSessionFaces.dock?.degradeNote?.()))

// 服务实例被替换（插件重载 / 禁用后重新启用）：必须重新注册，否则接入永久停在旧实例上。
const replaced = makeSidebarCtx({ better: true })
mod.apply(replaced.ctx)
const replacedFaces = facesOf(replaced)
check('重载前：open() 正常', replacedFaces.open?.('session-abc') === true)
const tabsBefore = replaced.betterTabs.length
const opensBefore = replaced.betterOpens.length
replaced.replaceBetter()
check('服务实例被替换后：重新注册并释放旧描述符',
  replaced.betterTabs.length === tabsBefore + 1
  && replaced.released.includes('dsh-plugin-structured-prompt:form'),
  `tabs=${replaced.betterTabs.length} released=${JSON.stringify(replaced.released)}`)
check('服务实例被替换后：open() 仍然有效',
  replacedFaces.open?.('session-abc') === true && replaced.betterOpens.length === opensBefore + 1)

// ---- 3d-3) 没有 ctx.inject 时仍能升级到 better-sidebar（审查抓到的 M1）----
//
// 老宿主没有 `ctx.inject`，原生先接上、better 后到 —— 唯一的机会就是"打开时再解析"。

const lateUpgrade = makeSidebarCtx({ attached: true, better: false })
delete lateUpgrade.ctx.inject
mod.apply(lateUpgrade.ctx)
const lateUpgradeFaces = facesOf(lateUpgrade)
check('native 先接上（无 ctx.inject）',
  lateUpgradeFaces.open?.() === true && lateUpgrade.tabTypes.length === 1)
lateUpgrade.provideBetter()
check('better 后到（无 ctx.inject）：打开时升级过去，并撤掉原生类型',
  lateUpgradeFaces.open?.('session-abc') === true
  && lateUpgrade.betterOpens.length === 1
  && lateUpgrade.released.includes('dsh-plugin-structured-prompt/structured-prompt-form'),
  `opens=${lateUpgrade.betterOpens.length} released=${JSON.stringify(lateUpgrade.released)}`)

// 切换前先关掉正开着的原生 tab：类型一撤，它会变成写着「内容不可用」的空壳。
const openNative = makeSidebarCtx({ attached: true, better: false, nativeOpenTab: 'structured-prompt-form' })
mod.apply(openNative.ctx)
openNative.provideBetter()
check('切到 better-sidebar 前先关掉开着的原生 tab（不留「内容不可用」空壳）',
  openNative.released.includes('native-tab-1'),
  JSON.stringify(openNative.released))

// ---- 3e) tab 类型与主体的形状 ----
const [tabType] = early.tabTypes
check('tab 类型带 id / kind / priority（页面类型，不认领资源地址）',
  tabType?.id === 'dsh-plugin-structured-prompt/structured-prompt-form'
  && tabType?.kind === 'structured-prompt-form'
  && tabType?.priority === 'extension'
  && tabType?.patterns === undefined,
  JSON.stringify(tabType))
check('tab 标题是每次取用的 thunk（语言变化时无需重新注册）',
  typeof tabType?.title === 'function' && tabType.title('sidebar://structured-prompt-form') === '结构化提示词')
check('tab 类型的注册随插件 fiber 释放（经 ctx.effect）',
  early.effects.some(name => String(name).includes('右侧栏')))

const tabEntry = earlyFaces.tab
check('注册了 tab 主体槽位 sidebar.right.pane.tab', tabEntry !== undefined)
// 键必须与第一步的 id 一致：宿主按 `definition.id` 派发主体，键写错就是"tab 打开了但空白"。
check('tab 主体的键与类型 id 一致（宿主按 id 派发）',
  tabEntry?.options.key === tabType?.id && String(tabEntry?.options.key ?? '') !== '',
  String(tabEntry?.options.key))
check('tab 主体声明了 store 座位', tabEntry?.options.store !== undefined)
check('tab 主体与入口共用同一个 store 句柄',
  tabEntry?.options.store !== undefined && tabEntry.options.store === earlyFaces.left?.options.store)
check('tab 主体不是入口按钮那个组件',
  tabEntry?.component !== undefined && tabEntry.component !== earlyFaces.left?.component)

const tabFace = tabEntry?.options.inject?.()
check('tab 主体拿到发送链路（send）', typeof tabFace?.send === 'function')
tabFace?.send('session-abc', '来自 tab 的正文')
await Promise.resolve()
await Promise.resolve()
check('tab 主体的 send 把内容交给会话的 conversation.send',
  early.sent.includes('来自 tab 的正文'), JSON.stringify(early.sent))

// ---- 3f) 接通后的状态收尾、inject 面字段与"可选探测方法" ----
//
// 顺序很要紧：`open()` 成功本身会清掉 failure，所以"接通即不报降级"必须在**任何一次成功 open
// 之前**求值 —— 现有那两条「不显示降级说明」都在 open 之后，被 open 的收尾代偿了（实测：
// 删掉 `wireBetter` 里的 `failure = undefined` 零红）。

const quietNative = makeSidebarCtx()
mod.apply(quietNative.ctx)
const quietNativeFaces = facesOf(quietNative)
check('原生右侧栏接通后（尚未打开）：降级说明为空',
  quietNativeFaces.dock?.degradeNote?.() === undefined,
  String(quietNativeFaces.dock?.degradeNote?.()))

const quietBetter = makeSidebarCtx({ better: true })
mod.apply(quietBetter.ctx)
const quietBetterFaces = facesOf(quietBetter)
check('better-sidebar 接通后（尚未打开）：降级说明为空',
  quietBetterFaces.dock?.degradeNote?.() === undefined,
  String(quietBetterFaces.dock?.degradeNote?.()))

check('tab 主体的 inject 面带目标会话（缺了宿主把 tab 渲染成空白）',
  earlyFaces.tab?.options.inject?.('session-abc')?.sessionId === 'session-abc',
  JSON.stringify(earlyFaces.tab?.options.inject?.('session-abc')))

// 宿主只实现契约里**必需**的两条（可选的 isTabEnabled/getTab/getSnapshot 缺失）时，仍必须认这个
// 服务 —— 把可选方法写成必需，旧宿主上的 better-sidebar 会静默消失。
const minimal = makeSidebarCtx({ better: true })
const minimalBase = minimal.ctx.get
const minimalOpens = []
minimal.ctx.get = (name) => (name === 'betterSidebar'
  ? { registerTab: () => () => {}, openTab: (seed, scope) => { minimalOpens.push({ seed, scope }) } }
  : minimalBase(name))
mod.apply(minimal.ctx)
const minimalFaces = facesOf(minimal)
check('宿主只给 registerTab / openTab（无可选探测方法）时仍用 better-sidebar',
  minimalFaces.open?.('session-abc') === true && minimalOpens.length === 1,
  `open=${String(minimalFaces.open?.('session-abc'))} opens=${minimalOpens.length}`)

// 故障恢复：openTab 修好后再次打开要成功，且说明清空（failure 的收尾）。
const healed = makeSidebarCtx({ failOpen: true })
mod.apply(healed.ctx)
const healedFaces = facesOf(healed)
const healedFirst = healedFaces.open?.()
healed.options.failOpen = false
check('原生 openTab 恢复后：再次打开成功并清掉降级说明',
  healedFirst === false && healedFaces.open?.() === true
  && healedFaces.dock?.degradeNote?.() === undefined,
  `first=${String(healedFirst)} note=${String(healedFaces.dock?.degradeNote?.())}`)

// 只有 sidebarRightTabs、没有 sidebarRight：不算接通（不能只挂类型、打开时才炸）。
const halfNative = makeSidebarCtx({ rightMissing: true })
mod.apply(halfNative.ctx)
const halfNativeFaces = facesOf(halfNative)
check('只缺 sidebarRight 时不算接通：open() 返回 false，且说明里写明缺的是 sidebarRight',
  halfNativeFaces.open?.() === false
  && String(halfNativeFaces.dock?.degradeNote?.()).includes('sidebarRight=无'),
  String(halfNativeFaces.dock?.degradeNote?.()))

// 原生类型要带 guide 入口：否则用户关掉 tab 后再也找不回来。
const nativeType = early.tabTypes[0]
check('原生 tab 类型带 guide 入口（标题 + 一句话说明）',
  Array.isArray(nativeType?.guide) && nativeType.guide.length === 1
  && typeof nativeType.guide[0]?.title === 'function'
  && nativeType.guide[0].title() === '结构化提示词'
  && typeof nativeType.guide[0]?.description === 'function',
  JSON.stringify(nativeType?.guide?.map(entry => entry.order)))

// ---- 4) 依赖面最小化 ----

// 本插件不读 remote 命名空间，也不读插件/skills 清单（工具名由用户手填），因此不应该依赖
// remote。一旦有人把 remote 加回来，这里会提醒：那意味着又引入了 RPC 依赖。
check('inject 只声明 slots',
  mod.inject.length === 1 && mod.inject[0] === 'slots', mod.inject.join(', '))
check('inject 不依赖 remote（本插件不读 remote 命名空间）',
  !mod.inject.some(name => name === 'remote' || name.startsWith('remote.')), mod.inject.join(', '))

if (failed > 0) {
  console.error(`\n${failed} 项注册契约测试未通过。`)
  process.exit(1)
}
console.log('\n全部注册契约测试通过。')
