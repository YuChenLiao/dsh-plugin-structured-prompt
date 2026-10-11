/**
 * 安装自检脚本：确认插件已被 desktop profile 正确安装，且两个半边都符合 DSH
 * 的加载契约。在插件源码变更或重新安装后运行，可在重启 DSH 之前发现问题。
 *
 * 用法：node tools/verify-install.mjs
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = 'dsh-plugin-structured-prompt'
const PROFILE_DIR = process.env.DSH_PROFILE_DIR ?? 'C:\\Users\\LYC\\.dsh\\profiles\\desktop'

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(label)
}

// 1) profile 的 node_modules 是否解析到本插件
const linked = resolve(PROFILE_DIR, 'node_modules', PLUGIN_ID)
check('profile node_modules 中的插件目录存在', existsSync(linked), linked)
if (existsSync(linked)) {
  check('该目录指向本插件源码', realpathSync(linked) === realpathSync(PLUGIN_ROOT),
    realpathSync(linked))
}

// 2) profile 清单是否声明依赖与 bundle
const manifestPath = resolve(PROFILE_DIR, 'package.json')
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  check('profile dependencies 声明了本插件', PLUGIN_ID in (manifest.dependencies ?? {}))
  check('profile bundles 注册了本插件',
    (manifest.dsh?.profile?.bundles ?? []).includes(PLUGIN_ID))
}

// 3) 生成了 Loader 行
const cordisPath = resolve(PROFILE_DIR, 'cordis.yml')
if (existsSync(cordisPath)) {
  const cordis = readFileSync(cordisPath, 'utf8')
  check('cordis.yml 含本插件的 Loader 行', cordis.includes(`id: ${PLUGIN_ID}`))
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

// 5) client 半边符合动态 bundle 契约
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
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 项检查未通过：${failures.join('; ')}`)
  process.exit(1)
}
console.log('\n全部安装自检通过。')
