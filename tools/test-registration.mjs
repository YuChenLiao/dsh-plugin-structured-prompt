/**
 * 插件注册契约测试（不需要 DSH 运行时）。
 *
 * 为什么需要它：渲染测试直接给组件喂 `useStore`，因此**绕过了框架的注入**。
 * 而 `useStore`/`actions` 并不是标准 props —— 渲染器只在注册声明了 `store`
 * 座位时才注入它们。漏声明会让组件拿到 `undefined`、渲染时抛错、条目被隔离
 * 失效（表现为"按钮消失"）。这条契约只能本文件这样在注册层校验。
 *
 * 覆盖：
 *  1. `apply()` 能在不抛错的情况下完成全部注册（含样式注入 effect）；
 *  2. 每个注册都声明了 store，且指向同一个句柄（实例才会共享）；
 *  3. 注册表与预期槽位/组件一一对应；
 *  4. 依赖面保持最小：只声明 `slots`（本插件不读主机数据，见 index.js 说明）。
 *
 * 用法：node --import ./tools/lib/loader-hook.mjs tools/test-registration.mjs
 */
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client')

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
  const ctx = {
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
  return { ctx, registrations, injected, effects }
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
const mod = await import(pathToFileURL(resolve(SRC, 'index.js')).href)

// ---- 1) apply() 全程不抛错 ----

const bench = makeCtx()
let applyError = null
try {
  mod.apply(bench.ctx)
} catch (error) {
  applyError = error
}
check('apply() 不抛错', applyError === null, applyError === null ? '' : String(applyError))
check('apply() 注册了两个槽位', bench.registrations.length === 2, `实际 ${bench.registrations.length}`)
check('apply() 处理了两个 inject 目标', bench.injected.length === 2, bench.injected.join(', '))
check('apply() 注入了样式 effect',
  bench.effects.includes('structured-prompt: styles'), bench.effects.join(' | '))

// ---- 2) 关键契约：每个注册都声明 store（否则 useStore 为 undefined）----

for (const { options } of bench.registrations) {
  check(`注册「${options.name}」声明了 store 座位`,
    options.store !== undefined && typeof options.store.create === 'function')
}
const handles = new Set(bench.registrations.map(entry => entry.options.store))
check('两个注册共用同一个 store 句柄（实例才会共享）', handles.size === 1, `句柄数 ${handles.size}`)

// ---- 3) 注册表与预期一一对应 ----

const byName = new Map(bench.registrations.map(entry => [entry.options.name, entry]))
check('注册了输入框工具栏入口', byName.has('conversation.input.left'))
check('注册了表单弹窗挂载点', byName.has('conversation.input.dock'))
check('入口与弹窗使用不同组件',
  byName.get('conversation.input.left')?.component !== byName.get('conversation.input.dock')?.component)
check('入口与弹窗使用同一个 id（各自槽位内唯一）',
  byName.get('conversation.input.left')?.options.id === 'structured-prompt'
  && byName.get('conversation.input.dock')?.options.id === 'structured-prompt')

// ---- 4) 依赖面最小化 ----

// 本插件不读主机数据（工具名由用户手填），因此不应该再依赖 remote。一旦有人
// 把 remote 加回来，这里会提醒：那意味着又引入了 RPC 依赖。
check('inject 只声明 slots', mod.inject.length === 1 && mod.inject[0] === 'slots',
  mod.inject.join(', '))
check('inject 不依赖 remote（本插件不读主机数据）',
  !mod.inject.some(name => name === 'remote' || name.startsWith('remote.')),
  mod.inject.join(', '))

if (failed > 0) {
  console.error(`\n${failed} 项注册契约测试未通过。`)
  process.exit(1)
}
console.log('\n全部注册契约测试通过。')
