/**
 * 测试用 ESM 加载钩子。做两件事：
 *
 * 1. **把 `@deepseek-ai/dsh-client-store` 指向本地桩**：源文件在 DSH 运行时由模块
 *    表提供该依赖（客户端 bundle 保留为 `require`），插件工程里没有这个包，离线
 *    运行需要一个等价的最小实现：`handle.create()` → 实例，actions 写入并通知订阅者。
 * 2. **把相对 `./x.js` 说明符解析到 `./x.ts` / `./x.tsx` 源**：源码遵循 DSH 的
 *    「本地相对导入写 `.js`」约定（tsdown 打包时重映射到 `.ts`），但 Node 直接运行时
 *    `.ts` 源旁边并没有 `.js` 文件 —— 这一步补上映射，测试才能直接跑源码。
 *
 * 通过 `node --import <本文件>` 注册。
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const STUB = pathToFileURL(resolve(HERE, 'store-stub.mjs')).href
const TARGET = '@deepseek-ai/dsh-client-store'

/**
 * 在被注入的 worker 里执行的解析钩子源码。
 *
 * 钩子运行在独立的 loader 线程，无法闭包捕获本文件的变量，因此依赖通过 import
 * 语句自带（`node:fs`、`node:url` 都是内置模块，在 data: URL 中可直接解析）。
 */
const HOOKS = `
import { existsSync } from 'node:fs'

export async function resolve(specifier, context, next) {
  if (specifier === ${JSON.stringify(TARGET)}) {
    return { url: ${JSON.stringify(STUB)}, shortCircuit: true }
  }
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
