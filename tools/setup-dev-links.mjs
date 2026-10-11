/**
 * 为离线测试准备 React：在本工程 `node_modules/` 下建立指向 DSH 源码树
 * 已安装的 react / react-dom 的链接。
 *
 * 为什么必须链接而不是各自安装：React 的 hook 依赖模块级单例，测试文件与
 * 被测组件的 react 必须是同一份实例，否则渲染会抛 hook 相关错误。
 *
 * 幂等：已存在的正确链接会被跳过；指向别处的链接会被重建。
 *
 * 用法：node tools/setup-dev-links.mjs
 */
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS_ROOT = process.env.DSH_SOURCE_ROOT ?? 'D:\\dsh\\deepseek-harness'

/**
 * 定位某个包在源码树中的安装目录。
 * @param name - 包名。
 * @param extraBases - 额外的解析基准（相对源码树），用于只在子包内安装的包。
 * @returns 该包的绝对路径。
 * @throws {Error} 当源码树里找不到它时。
 */
function locate(name, extraBases = []) {
  // 从每个可能装了该包的 client 子包位置解析；pnpm 会把它们链接到 store。
  const candidates = extraBases.map(relative => join(HARNESS_ROOT, relative))
  const clients = join(HARNESS_ROOT, 'packages', 'client')
  if (existsSync(clients)) {
    for (const entry of readdirSync(clients)) candidates.push(join(clients, entry))
  }
  candidates.push(HARNESS_ROOT)
  for (const base of candidates) {
    const probe = join(base, 'package.json')
    if (!existsSync(probe)) continue
    try {
      const req = createRequire(probe)
      const resolved = req.resolve(`${name}/package.json`)
      return dirname(resolved)
    } catch {
      // 这个基准位置没有该包：继续找下一个。
    }
  }
  throw new Error(`在 ${HARNESS_ROOT} 中找不到 ${name}；请用 DSH_SOURCE_ROOT 指向 DSH 源码树`)
}

const target = join(PLUGIN_ROOT, 'node_modules')
mkdirSync(target, { recursive: true })

/**
 * 建立（或修复）一个指向源码树安装位置的链接。
 * @param name - 包名；含 `/` 时会创建中间目录。
 * @param source - 目标绝对路径。
 */
function link(name, source) {
  const dest = join(target, name)
  const existing = lstatSync(dest, { throwIfNoEntry: false })
  if (existing !== undefined) {
    let same = false
    try {
      same = resolve(dest) === resolve(source)
    } catch {
      same = false
    }
    if (same) {
      console.log(`OK    已就绪 ${name} -> ${source}`)
      return
    }
    rmSync(dest, { recursive: true, force: true })
  }
  mkdirSync(dirname(dest), { recursive: true })
  symlinkSync(source, dest, 'junction')
  console.log(`OK    建立链接 ${name} -> ${source}`)
}

// react / react-dom：运行时由模块表提供，这里只是让离线测试能解析到同一实例。
for (const name of ['react', 'react-dom']) {
  link(name, locate(name))
}

// @types/react：类型检查用。与运行时 react 同版本，避免 JSX 类型漂移。
const reactTypes = locate('@types/react', [join('packages', 'client', 'ui-primitives')])
link('@types/react', reactTypes)

console.log('开发态链接准备完成。')
