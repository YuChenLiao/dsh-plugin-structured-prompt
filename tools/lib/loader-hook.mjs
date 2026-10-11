/**
 * ESM 模块重定向钩子：把源码里对 `@deepseek-ai/dsh-client-store` 的导入指向本
 * 测试桩。
 *
 * 源文件在 DSH 运行时由模块表提供该依赖；在插件工程里没有这个包，因此离线
 * 渲染测试需要一个等价的最小实现（zustand/immer 的语义已由宿主提供，这里只需
 * 保证「handle.create() → 实例，actions 写入并通知订阅者」这一契约）。
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

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (specifier === ${JSON.stringify(TARGET)}) {
        return { url: ${JSON.stringify(STUB)}, shortCircuit: true }
      }
      return next(specifier, context)
    }
  `)}`,
  pathToFileURL(`${HERE}/`),
)
