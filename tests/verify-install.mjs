/**
 * 安装自检：确认插件已被 desktop profile 正确安装，产物符合 DSH 加载契约，并且
 * 源码保持模块化（单文件行数上限）。
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

// 1) profile 的 node_modules 是否解析到本插件
const linked = resolve(PROFILE_DIR, 'node_modules', PLUGIN_ID)
check('profile node_modules 中的插件目录存在', existsSync(linked), linked)
if (existsSync(linked)) {
  check('该目录指向本插件源码', realpathSync(linked) === realpathSync(PLUGIN_ROOT), realpathSync(linked))
}

// 2) profile 清单是否声明依赖与 bundle
const manifestPath = resolve(PROFILE_DIR, 'package.json')
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  check('profile dependencies 声明了本插件', PLUGIN_ID in (manifest.dependencies ?? {}))
  check('profile bundles 注册了本插件', (manifest.dsh?.profile?.bundles ?? []).includes(PLUGIN_ID))
}

// 3) 生成了 Loader 行
const cordisPath = resolve(PROFILE_DIR, 'cordis.yml')
if (existsSync(cordisPath)) {
  check('cordis.yml 含本插件的 Loader 行', readFileSync(cordisPath, 'utf8').includes(`id: ${PLUGIN_ID}`))
}

// 4) host 半边可被导入且导出 apply
const hostEntry = resolve(PLUGIN_ROOT, 'lib', 'index.js')
check('host 产物存在', existsSync(hostEntry), hostEntry)
if (existsSync(hostEntry)) {
  try {
    const mod = await import(pathToFileURL(hostEntry).href)
    check('host 半边导出 apply()', typeof mod.apply === 'function')
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

if (failures.length > 0) {
  console.error(`\n${failures.length} 项检查未通过：${failures.join('; ')}`)
  process.exit(1)
}
console.log('\n全部安装自检通过。')
