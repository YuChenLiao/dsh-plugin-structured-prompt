/**
 * 安装自检：确认插件已被 profile 正确安装（`link:` 或 `github:` 皆可），产物符合
 * DSH 加载契约，本地构建与源码同步，并且源码保持模块化（单文件行数上限）。
 *
 * 覆盖七类检查：profile 安装状态、profile 清单里的依赖与 bundles 声明、插件自带的
 * bundle patch、host 半边的导出与零 import、client 产物的动态 bundle 格式、源码模块化
 * 与行数上限、产物不比源码旧。
 *
 * 在源码变更或重新安装后运行，可在重启 DSH 之前发现问题。
 *
 * 用法：node tests/verify-install.mjs
 */
import { readFileSync, existsSync, realpathSync, readdirSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = 'dsh-plugin-structured-prompt'
const PROFILE_DIR = process.env.DSH_PROFILE_DIR ?? 'C:\\Users\\LYC\\.dsh\\profiles\\desktop'

/** 单个源文件的行数上限：超过说明该再拆一层。 */
const MAX_SOURCE_LINES = 260

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(label)
}

// 1) profile 的 node_modules 里装到了本插件
const installed = resolve(PROFILE_DIR, 'node_modules', PLUGIN_ID)
check('profile node_modules 中的插件目录存在', existsSync(installed), installed)
if (existsSync(installed)) {
  // 两种安装方式都合法：`link:` 指向本工作区源码，`github:` 是独立副本。
  const linkedHere = realpathSync(installed) === realpathSync(PLUGIN_ROOT)
  const spec = readProfileDependency()
  check('依赖指向本插件（link 本目录或 github 源）',
    linkedHere || spec.startsWith('github:'), spec)
  check('装到的包含 client 产物', existsSync(join(installed, 'lib', 'client.js')))
  check('装到的包含 host 产物', existsSync(join(installed, 'lib', 'structured.js')))
  check('装到的包不含 node_modules（否则会破坏 pnpm 安装）',
    !existsSync(join(installed, 'node_modules')))
  // 本工作区不再有 node_modules：见 tools/setup-dev-links.mjs 的说明。
  check('本工作区无 node_modules（开发依赖在 .dev-deps/）',
    !existsSync(join(PLUGIN_ROOT, 'node_modules')))
}

/** 读取 profile 清单里本插件的依赖规格。 */
function readProfileDependency() {
  const manifestPath = resolve(PROFILE_DIR, 'package.json')
  if (!existsSync(manifestPath)) return ''
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return String(manifest.dependencies?.[PLUGIN_ID] ?? '')
}

// 2) profile 清单是否声明依赖与 bundle
const manifestPath = resolve(PROFILE_DIR, 'package.json')
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  check('profile dependencies 声明了本插件', PLUGIN_ID in (manifest.dependencies ?? {}))
  check('profile bundles 注册了本插件', (manifest.dsh?.profile?.bundles ?? []).includes(PLUGIN_ID))
}

// 3) Loader 行的来源。注意 cordis.yml 是**空的根**（内容就是 `[]`，其注释写明
//    "Edit cordis.patch.yml, not this file"）：真正的配置树由 package.json 的
//    `dsh.profile.bundles` 加上每个 bundle 自带的 cordis.patch.yml 在启动时合成。
//    所以这里检查这两个**输入**，而不是去 cordis.yml 里找合成结果。
const patchFile = resolve(PLUGIN_ROOT, 'cordis.patch.yml')
check('插件自带 bundle patch 文件', existsSync(patchFile))
if (existsSync(patchFile)) {
  const patchText = readFileSync(patchFile, 'utf8')
  // 两条装载行：一条用**精确包名**（它是 client 半边的宿主），一条用子路径指向提示词库组件。
  // 精确包名那条的 `name` 就是 `PLUGIN_ID` 本身，所以这里不能只查子路径写法。
  check('patch 声明了两条装载行（结构化 + 提示词库）',
    new RegExp(`name:\\s*${PLUGIN_ID}\\s*$`, 'm').test(patchText)
    && patchText.includes(`name: ${PLUGIN_ID}/library`),
    patchText.split('\n').filter(line => line.includes('name:')).map(line => line.trim()).join(' | '))
}
const ownManifest = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, 'package.json'), 'utf8'))
check('清单的 dsh.bundle.patch 指向该文件', ownManifest.dsh?.bundle?.patch === './cordis.patch.yml',
  String(ownManifest.dsh?.bundle?.patch))

// 3b) 装载行 → exports → 产物名 三方一致。
//
// 只查 patch 的文本包含是不够的：`exports` 被删掉、或指向另一个组件的产物时，装载行会指向不存在
// 的入口（或装到错的组件），而本机八套测试**全绿** —— 这种组合只有真的启动 DSH 才暴露。
const componentExports = ownManifest.exports ?? {}
for (const component of ['structured', 'library']) {
  const target = componentExports[`./${component}`]?.default ?? ''
  check(`exports 提供组件入口 ./${component} → lib/${component}.js`,
    target === `./lib/${component}.js`, String(target) || '(缺失)')
}
for (const file of ['structured.js', 'library.js']) {
  check(`exports 指向的产物真实存在（lib/${file}）`,
    existsSync(resolve(PLUGIN_ROOT, 'lib', file)))
}
check('包名入口指向 structured 产物（包名行同时是 client 半边的宿主）',
  componentExports['.']?.default === './lib/structured.js',
  String(componentExports['.']?.default ?? '(缺失)'))
check('装载行的 name 都落在 exports 的入口上', (() => {
  if (!existsSync(patchFile)) return false
  const names = [...readFileSync(patchFile, 'utf8').matchAll(/^\s*name:\s*(\S+)\s*$/gm)]
    .map(match => match[1])
  // 恰好两条：一条是精确包名（走 exports['.']），另一条是 `<包名>/<组件>`（走 exports['./<组件>']）。
  if (names.length !== 2) return false
  return names.every((name) => {
    if (name === PLUGIN_ID) return componentExports['.']?.default === './lib/structured.js'
    const prefix = `${PLUGIN_ID}/`
    if (!name.startsWith(prefix)) return false
    const component = name.slice(prefix.length)
    return componentExports[`./${component}`]?.default === `./lib/${component}.js`
  })
})(), (() => {
  const names = existsSync(patchFile)
    ? [...readFileSync(patchFile, 'utf8').matchAll(/^\s*name:\s*(\S+)\s*$/gm)].map(match => match[1])
    : []
  return `patch=${names.join(', ') || '(无)'} exports=${Object.keys(componentExports).join(', ')}`
})())

// 3c) **恰有一条装载行用精确包名** —— client 半边只认它。
//
// DSH 的 client 模块系统按「Loader 条目里声明了 `dsh.client` 的包」组 graph，取包名用的是
// `exactPackageSpecifier`：它对**含 `/` 的 specifier** 返回 `undefined`，那一行于是不被当成
// client row（见 DSH 源码 `packages/client/modules/src/client/manifest.ts` 的同名函数）。
// 两条装载行都写成包子路径时，client bundle **一次都不会加载** —— 界面上两个入口一起消失，
// 而本机所有测试都是绿的（它们只查注册与产物，不查 DSH 的解析规则）。这条断言就是那次事故的守护。
const rowNames = existsSync(patchFile)
  ? [...readFileSync(patchFile, 'utf8').matchAll(/^\s*name:\s*(\S+)\s*$/gm)].map(match => match[1])
  : []
/**
 * 与 DSH 的 `exactPackageSpecifier` 同源：裸包名（含 `@scope/name`）才算，子路径不算。
 * @param name - 装载行的 `name`。
 * @returns 是否是精确包名。
 */
const isBarePackageName = (name) => {
  if (name.startsWith('@')) {
    const parts = name.split('/')
    return parts.length === 2 && parts.every(Boolean)
  }
  return name.length > 0 && !name.includes('/') && !name.includes(':')
}
const bareRows = rowNames.filter(isBarePackageName)
check('恰有一条装载行用精确包名（client 半边靠它加载；两条都写子路径会让界面入口全消失）',
  bareRows.length === 1 && bareRows[0] === PLUGIN_ID,
  `装载行=${rowNames.join(', ') || '(无)'} 精确包名=${bareRows.join(', ') || '(无)'}`)

// 4) host 产物：两个组件入口都可导入、都导出 apply，且都自包含
//
// 包名入口**就是**结构化组件的产物（`exports['.']` → `lib/structured.js`），不再有单独的聚合
// 产物 —— 包名行同时承担"加载 client 半边"的职责，所以它必须是一个真实的组件入口。
const HOST_ENTRIES = [
  { file: 'structured.js', label: '结构化组件（也是包名入口与 client 半边的宿主）' },
  { file: 'library.js', label: '提示词库组件' },
]
for (const entry of HOST_ENTRIES) {
  const hostEntry = resolve(PLUGIN_ROOT, 'lib', entry.file)
  check(`host 产物存在（${entry.label}）`, existsSync(hostEntry), hostEntry)
  if (!existsSync(hostEntry)) continue
  try {
    const mod = await import(pathToFileURL(hostEntry).href)
    check(`host 产物导出 apply（${entry.label}）`, typeof mod.apply === 'function')
    check(`host 产物导出 inject（${entry.label}）`, Array.isArray(mod.inject))
    // 自包含约束（见 README「为什么工具定义是手写的」）：import 任何宿主包都会让
    // link: 安装下的插件停在未激活状态 —— 模块加载失败，而且不报错。
    const hostText = readFileSync(hostEntry, 'utf8')
    // 动态 `import()` 不会在链接期失败（那时它还没执行），但同样会在执行到它时解析
    // 宿主包 —— 失败时机更晚、更难定位，因此一并挡住，而不是只挡行首的静态 import。
    check(`host 产物自包含（${entry.label}，无 import / require）`,
      !/^\s*import[\s{'"]/m.test(hostText)
      && !/\bimport\s*\(/.test(hostText)
      && !/\brequire\s*\(/.test(hostText))
  } catch (error) {
    check(`host 产物可导入（${entry.label}）`, false, String(error))
  }
}

// 5) client 产物符合动态 bundle 契约
const clientEntry = resolve(PLUGIN_ROOT, 'lib', 'client.js')
check('client 产物存在', existsSync(clientEntry), clientEntry)
if (existsSync(clientEntry)) {
  const source = readFileSync(clientEntry, 'utf8')
  check('client 产物使用 __ModuleLoader__.load 包装',
    source.includes('window.__ModuleLoader__.load'))
  check('client 产物 id 与本包名一致', source.includes(JSON.stringify(PLUGIN_ID)))
  check('client 产物导出 apply', /exports\.apply\s*=/.test(source))
  check('client 产物导出 inject', /exports\.inject\s*=/.test(source))
  // 共享模块必须保持 require 外部引用，不能内联进产物。
  check('共享模块 react 走 require 外部引用', source.includes('require("react")'))
  check('不再 require DSH 其它包（依赖面最小）',
    !/require\("@deepseek-ai\/dsh-(?!client-store)/.test(source))
}

// 6) 源码保持模块化：单文件行数上限
const sourceRoot = resolve(PLUGIN_ROOT, 'src')
/** 递归收集源文件。 */
function collect(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collect(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}
const sources = collect(sourceRoot)
check('源码已拆分为多个模块', sources.length >= 10, `${sources.length} 个文件`)
const oversized = sources
  .map(file => ({ file: file.slice(PLUGIN_ROOT.length + 1), lines: readFileSync(file, 'utf8').split('\n').length }))
  .filter(row => row.lines > MAX_SOURCE_LINES)
check(`没有单文件超过 ${MAX_SOURCE_LINES} 行`, oversized.length === 0,
  oversized.map(row => `${row.file}=${row.lines}`).join(', '))
check('入口文件保持精简（不承载 UI 实现）',
  readFileSync(resolve(sourceRoot, 'client', 'index.ts'), 'utf8').split('\n').length <= 140)

// 7) 本地产物不比源码旧：改了 src 却忘记 build 时，提交出去的 lib 会落后于源码
//    （而安装方加载的正是 lib）。
//
// 按半边划分源码集合：`lib/index.js` 由 host 半边 + shared + 入口决定，`lib/client.js` 由 client
// 半边 + shared 决定。用"全部源码 vs 单个产物"比会把另一边算进来 —— 只改 host 时 client 产物会被
// 误判成"没重新构建"（它其实根本没变）。
//
// 容差 2 秒：`git checkout` / `merge` 会把工作区文件的 mtime 刷成同一时刻，读写顺序造成的毫秒级
// 乱序会让严格比较误报"未重建"。真正的落后是"改完源码几分钟内没构建"，容差照样抓得住。
const MTIME_TOLERANCE_MS = 2000
/** 某个产物对应的源码集合。 */
const sourcesUnder = (prefixes) => sources.filter((file) => {
  const relative = file.slice(PLUGIN_ROOT.length + 1).replace(/\\/g, '/')
  return prefixes.some(prefix => relative.startsWith(prefix))
})
const newestOf = (files) => Math.max(...files.map(file => statSync(file).mtimeMs))
// 按半边划分源码集合：组件拆分后 host 与 client 不再各是一个目录，所以用显式的前缀清单，
// 而不是"某个目录 vs 某个目录"。
const HOST_SOURCES = [
  'src/index.ts',
  'src/shared/',
  'src/components/structured/index.ts',
  'src/components/structured/host/',
  'src/components/structured/shared/',
  'src/components/library/index.ts',
  'src/components/library/host/',
  'src/components/library/shared/',
]
const CLIENT_SOURCES = [
  'src/client/',
  'src/shared/',
  'src/components/structured/client.ts',
  'src/components/structured/client/',
  'src/components/structured/shared/',
  'src/components/library/client.ts',
  'src/components/library/client/',
  'src/components/library/shared/',
]
const hostNewest = newestOf(sourcesUnder(HOST_SOURCES))
const clientNewest = newestOf(sourcesUnder(CLIENT_SOURCES))
for (const entry of HOST_ENTRIES) {
  const file = resolve(PLUGIN_ROOT, 'lib', entry.file)
  const built = existsSync(file) ? statSync(file).mtimeMs : 0
  check(`lib/${entry.file} 不早于它对应的源码（已重新构建，${entry.label}）`,
    built >= hostNewest - MTIME_TOLERANCE_MS,
    `bundle=${built === 0 ? '缺失' : new Date(built).toISOString()}`
    + ` newestSrc=${new Date(hostNewest).toISOString()}（容差 ${MTIME_TOLERANCE_MS}ms）`)
}
const clientBundleTime = existsSync(clientEntry) ? statSync(clientEntry).mtimeMs : 0
check('lib/client.js 不早于它对应的源码（已重新构建）',
  clientBundleTime >= clientNewest - MTIME_TOLERANCE_MS,
  `bundle=${new Date(clientBundleTime).toISOString()} newestSrc=${new Date(clientNewest).toISOString()}`
  + `（容差 ${MTIME_TOLERANCE_MS}ms）`)

if (failures.length > 0) {
  console.error(`\n${failures.length} 项检查未通过：${failures.join('; ')}`)
  process.exit(1)
}
console.log('\n全部安装自检通过。')
