/**
 * 安装自检：确认插件已被 profile 正确安装（`link:` 或 `github:` 皆可），产物符合
 * DSH 加载契约，本地构建与源码同步，并且源码保持模块化（单文件行数上限）。
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
  check('装到的包含 host 产物', existsSync(join(installed, 'lib', 'index.js')))
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
  check('patch 声明了本插件的装载行',
    readFileSync(patchFile, 'utf8').includes(`id: ${PLUGIN_ID}`))
}
const ownManifest = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, 'package.json'), 'utf8'))
check('清单的 dsh.bundle.patch 指向该文件', ownManifest.dsh?.bundle?.patch === './cordis.patch.yml',
  String(ownManifest.dsh?.bundle?.patch))

// 4) host 半边可被导入且导出 apply
const hostEntry = resolve(PLUGIN_ROOT, 'lib', 'index.js')
check('host 产物存在', existsSync(hostEntry), hostEntry)
if (existsSync(hostEntry)) {
  try {
    const mod = await import(pathToFileURL(hostEntry).href)
    check('host 半边导出 apply()', typeof mod.apply === 'function')
    check('host 半边导出 inject', Array.isArray(mod.inject))
    // 自包含约束（见 README「为什么工具定义是手写的」）：import 任何宿主包都会让
    // link: 安装下的插件停在未激活状态 —— 模块加载失败，而且不报错。
    const hostText = readFileSync(hostEntry, 'utf8')
    // 动态 `import(...)` 与静态 import 一样会在加载期解析宿主包，必须一起挡住：
    // 单看行首的 import 会漏掉 `await import('@deepseek-ai/dsh-tools')` 这种写法。
    check('host 产物自包含（无 import / require）',
      !/^\s*import[\s{'"]/m.test(hostText)
      && !/\bimport\s*\(/.test(hostText)
      && !/\brequire\s*\(/.test(hostText))
  } catch (error) {
    check('host 半边可导入', false, String(error))
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
const newestSource = Math.max(...sources.map(file => statSync(file).mtimeMs))
const bundleTime = existsSync(clientEntry) ? statSync(clientEntry).mtimeMs : 0
check('lib/client.js 不早于最新源码（已重新构建）', bundleTime >= newestSource,
  `bundle=${new Date(bundleTime).toISOString()} newestSrc=${new Date(newestSource).toISOString()}`)

if (failures.length > 0) {
  console.error(`\n${failures.length} 项检查未通过：${failures.join('; ')}`)
  process.exit(1)
}
console.log('\n全部安装自检通过。')
