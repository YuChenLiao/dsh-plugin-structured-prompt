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
check('apply() 注册了四个槽位（两个组件各两条）',
  bench.registrations.length === 4, `实际 ${bench.registrations.length}`)
check('apply() 处理了四个 inject 目标', bench.injected.length === 4, bench.injected.join(', '))
check('apply() 注入了样式 effect',
  bench.effects.includes('structured-prompt: styles'), bench.effects.join(' | '))

// ---- 2) 关键契约：每个注册都声明 store（否则 useStore 为 undefined）----

for (const { options } of bench.registrations) {
  check(`注册「${options.name}」(${options.id}) 声明了 store 座位`,
    options.store !== undefined && typeof options.store.create === 'function')
}
// 拆分后**每个组件各有自己的 store 句柄**：同一组件的两条注册必须共用它（否则实例不共享、
// 入口驱动不了弹窗），两个组件之间必须是**不同**句柄（否则状态又耦合回去，那正是这次拆分的理由）。
const byId = new Map()
for (const entry of bench.registrations) {
  const id = String(entry.options.id)
  byId.set(id, [...(byId.get(id) ?? []), entry])
}
check('注册分属两个组件（各两条：入口 + 弹窗）',
  byId.size === 2 && [...byId.values()].every(bucket => bucket.length === 2),
  [...byId.entries()].map(([id, list]) => `${id}×${list.length}`).join(', '))
check('同一组件的两条注册共用同一个 store 句柄',
  [...byId.values()].every(bucket => new Set(bucket.map(entry => entry.options.store)).size === 1))
check('两个组件用的是不同句柄（状态不耦合）',
  new Set(bench.registrations.map(entry => entry.options.store)).size === 2)
// 句柄的**行为契约**：只比"句柄相同/不同"抓不到"把库组件的 store 换成结构化的"—— 那两者都是
// 合法句柄、句柄也仍然不同，只是绑错了（实测这种变异在运行期的其它断言里 0 条红）。所以按组件
// 断言各自动作表里该有的动作。注意动作表在**实例**上（`handle.create(sessionId).actions`）。
const actionsOf = entry => Object.keys(entry.options.store.create('probe').actions ?? {})
const actionsById = new Map([...byId.entries()].map(([id, bucket]) => [id, actionsOf(bucket[0])]))
check('结构化组件的 store 提供表单动作（setForm / setField / addTool）',
  ['setForm', 'setField', 'addTool'].every(name => actionsById.get('structured-prompt')?.includes(name)),
  JSON.stringify(actionsById.get('structured-prompt')))
check('提示词库组件的 store 提供检索动作（patch / backToList）',
  ['patch', 'backToList', 'open', 'close'].every(name => actionsById.get('prompt-library')?.includes(name)),
  JSON.stringify(actionsById.get('prompt-library')))
check('每个组件的入口与弹窗占两个不同槽位',
  [...byId.values()].every(bucket =>
    new Set(bucket.map(entry => entry.options.name)).size === 2
    && bucket.some(entry => entry.options.name === 'conversation.input.left')
    && bucket.some(entry => entry.options.name === 'conversation.input.dock')))

// ---- 3) 注册表与预期一一对应 ----

const docks = [...byId.values()].map(bucket =>
  bucket.find(entry => entry.options.name === 'conversation.input.dock'))
check('两个组件都注册了弹窗挂载点', docks.length === 2 && docks.every(entry => entry !== undefined))
check('入口与弹窗使用不同组件', [...byId.values()].every(bucket => {
  const left = bucket.find(entry => entry.options.name === 'conversation.input.left')
  const dock = bucket.find(entry => entry.options.name === 'conversation.input.dock')
  return left?.component !== undefined && dock?.component !== undefined && left.component !== dock.component
}))

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
