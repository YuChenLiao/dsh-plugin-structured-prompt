/**
 * 测试用 ESM 加载钩子。做三件事：
 *
 * 1. **把 `@deepseek-ai/dsh-client-store` 指向本地桩**：源文件在 DSH 运行时由模块
 *    表提供该依赖（客户端 bundle 保留为 `require`），插件工程里没有这个包，离线
 *    运行需要一个等价的最小实现：`handle.create()` → 实例，actions 写入并通知订阅者。
 * 2. **把 `react` / `react-dom` 指向 `.dev-deps/`**：开发期依赖刻意**不放在
 *    node_modules**（见 `tools/setup-dev-links.mjs` 的说明）。
 * 3. **把相对 `./x.js` 说明符解析到 `./x.ts` / `./x.tsx` 源**：源码遵循 DSH 的
 *    「本地相对导入写 `.js`」约定（tsdown 打包时重映射到 `.ts`），但 Node 直接运行时
 *    `.ts` 源旁边并没有 `.js` 文件 —— 这一步补上映射，测试才能直接跑源码。
 *
 * 通过 `node --import <本文件>` 注册。
 */
import { existsSync } from 'node:fs'
import { register } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..', '..')
/** 开发期依赖目录：与 node_modules 刻意区分，避免破坏 pnpm 安装。 */
const DEV_DEPS = join(PLUGIN_ROOT, '.dev-deps')

/**
 * 重定向表：说明符 → 目标文件 URL。
 *
 * 只收录**实际存在**的目标，未建立开发态链接时不拦截该说明符，让 Node 按常规解析
 * （或给出它自己的"找不到模块"错误），而不是在这里制造难懂的失败。
 */
const REDIRECTS = {}
const redirect = (specifier, target) => {
  if (existsSync(target)) REDIRECTS[specifier] = pathToFileURL(target).href
}

// 宿主模块表提供的包。
redirect('@deepseek-ai/dsh-client-store', resolve(HERE, 'store-stub.mjs'))
// 开发期依赖（tools/setup-dev-links.mjs 建立）。
redirect('react', join(DEV_DEPS, 'react', 'index.js'))
redirect('react/jsx-runtime', join(DEV_DEPS, 'react', 'jsx-runtime.js'))
redirect('react-dom', join(DEV_DEPS, 'react-dom', 'index.js'))
redirect('react-dom/server', join(DEV_DEPS, 'react-dom', 'server.js'))

if (!existsSync(DEV_DEPS)) {
  console.error(
    '[loader-hook] 未找到 .dev-deps/：请先运行 `node tools/setup-dev-links.mjs`'
    + '（它会把 react / react-dom / @types-react 链接到 DSH 源码树）。',
  )
}

/**
 * 在被注入的 loader 线程里执行的解析钩子源码。
 *
 * 钩子无法闭包捕获本文件的变量，因此重定向表以字面量注入；`node:fs` 是内置模块，
 * 在 data: URL 中可直接解析。
 */
const HOOKS = `
import { existsSync } from 'node:fs'

const REDIRECTS = ${JSON.stringify(REDIRECTS)}

export async function resolve(specifier, context, next) {
  const target = REDIRECTS[specifier]
  if (target !== undefined) return { url: target, shortCircuit: true }
  // 相对导入写 .js，磁盘上却是 .ts/.tsx：映射到真实文件再交给默认解析。
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
    const base = new URL(specifier, context.parentURL).href
    for (const ext of ['.ts', '.tsx']) {
      const candidate = base.slice(0, -3) + ext
      if (existsSync(new URL(candidate))) return { url: candidate, shortCircuit: true }
    }
  }
  return next(specifier, context)
}
`

register(`data:text/javascript,${encodeURIComponent(HOOKS)}`, pathToFileURL(`${HERE}/`))
