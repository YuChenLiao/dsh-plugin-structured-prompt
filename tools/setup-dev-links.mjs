/**
 * 为离线开发准备 React：在本工程 `.dev-deps/` 下建立指向 DSH 源码树已安装的
 * react / react-dom / @types/react 的链接。
 *
 * 为什么必须链接而不是各自安装：React 的 hook 依赖模块级单例，测试文件与被测组件
 * 的 react 必须是同一份实例，否则渲染会抛 hook 相关错误。
 *
 * **为什么不放在 `node_modules/`**：本工程是一个 DSH 插件包，用户会用
 * `dsh plugin add link:<本目录>` 安装它。pnpm 处理这种本地链接时会把包目录里的
 * `node_modules` 一并纳入包的快照；之后改用 `github:` 安装时，pnpm 会试图重建那些
 * 符号链接，在 Windows 上以 `ERR_PNPM_EPERM` 失败，并把已装好的插件留成"已卸载"
 * 状态。因此开发期依赖一律放在 `node_modules` 之外的 `.dev-deps/`：
 *  - 类型检查：`tsconfig.json` 的 `paths` 指向 `.dev-deps/@types-react`；
 *  - 测试运行：`tools/lib/loader-hook.mjs` 把 react / react-dom 重定向到这里；
 *  - 版本控制：`.gitignore` 排除整个目录。
 *
 * 幂等：已存在的正确链接会被跳过，指向别处的会被重建。
 *
 * 用法：node tools/setup-dev-links.mjs
 */
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS_ROOT = process.env.DSH_SOURCE_ROOT ?? 'D:\\dsh\\deepseek-harness'
const DEV_DEPS = join(PLUGIN_ROOT, '.dev-deps')

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
      return dirname(req.resolve(`${name}/package.json`))
    } catch {
      // 这个基准位置没有该包：继续找下一个。
    }
  }
  throw new Error(`在 ${HARNESS_ROOT} 中找不到 ${name}；请用 DSH_SOURCE_ROOT 指向 DSH 源码树`)
}

/**
 * 建立（或修复）一个指向源码树安装位置的链接。
 * @param name - 在 `.dev-deps/` 下的目录名。
 * @param source - 目标绝对路径。
 */
function link(name, source) {
  const dest = join(DEV_DEPS, name)
  const existing = lstatSync(dest, { throwIfNoEntry: false })
  if (existing !== undefined) {
    let same = false
    try {
      same = resolve(dest) === resolve(source)
    } catch {
      same = false
    }
    if (same) {
      console.log(`OK    已就绪 .dev-deps/${name} -> ${source}`)
      return
    }
    rmSync(dest, { recursive: true, force: true })
  }
  mkdirSync(dirname(dest), { recursive: true })
  symlinkSync(source, dest, 'junction')
  console.log(`OK    建立链接 .dev-deps/${name} -> ${source}`)
}

mkdirSync(DEV_DEPS, { recursive: true })

// 运行时包：测试与组件必须是同一实例（见文件头）。
link('react', locate('react'))
link('react-dom', locate('react-dom'))

// 类型：与运行时 react 同版本，避免 JSX 类型漂移。目录名取 `@types-react` 而不是
// 嵌套的 `@types/react`，少一层目录，也让 tsconfig 的 paths 更直白。
link('@types-react', locate('@types/react', [join('packages', 'client', 'ui-primitives')]))


// 顺带清掉历史遗留：早期版本把链接建在 node_modules/，它会破坏 pnpm 安装。
const legacy = join(PLUGIN_ROOT, 'node_modules')
if (existsSync(legacy)) {
  rmSync(legacy, { recursive: true, force: true })
  console.log('OK    已清理历史遗留的 node_modules/（它会破坏 dsh plugin add）')
}

console.log('开发态依赖准备完成（.dev-deps/）。')
