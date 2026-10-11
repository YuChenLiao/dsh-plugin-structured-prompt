/**
 * 结构化输入任务插件的构建脚本。
 *
 * 两个产物：
 *  - `lib/index.js`   host 半边，ESM，供 DSH Loader 导入。
 *  - `lib/client.js`  浏览器半边，CJS 闭包工厂，产物格式必须与 DSH 的动态
 *                     client bundle 契约一致：
 *                     `window.__ModuleLoader__.load({ id, factory: (require) => {...} })`
 *                     共享模块（react、cordis 等）通过注入的 `require` 解析，
 *                     其余依赖内联。
 *
 * 打包器复用 DSH 源码树 `D:\dsh\deepseek-harness` 中已安装的 tsdown，
 * 因此本插件自身不需要任何 devDependency 与网络安装。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

/** 仓库根目录（本文件位于 <插件根>/tools/lib/）。 */
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** DSH 源码树：打包器的来源。可用 DSH_SOURCE_ROOT 环境变量覆盖。 */
const HARNESS_ROOT = process.env.DSH_SOURCE_ROOT ?? 'D:\\dsh\\deepseek-harness'

/** 插件 id：写入 __ModuleLoader__.load 的 id，必须是包的准确名字。 */
const PLUGIN_ID = 'dsh-plugin-structured-prompt'

/** 冻结的共享模块表：这些 specifier 保持 import，由注入的 require 解析。 */
const BASELINE_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * 载入 DSH 源码树里的 tsdown。
 * @returns tsdown 的 `build` 函数。
 */
async function loadTsdown() {
  const entry = resolve(HARNESS_ROOT, 'node_modules', 'tsdown', 'dist', 'index.mjs')
  if (!existsSync(entry)) {
    throw new Error(`未找到 tsdown：${entry}；请用 DSH_SOURCE_ROOT 指向 DSH 源码树`)
  }
  // Windows 绝对路径必须转成 file:// URL 才能被动态 import 接受。
  const mod = await import(pathToFileURL(entry).href)
  if (typeof mod.build !== 'function') {
    throw new Error(`tsdown 未导出 build()：${entry}`)
  }
  return mod.build
}

/** 构建 host 半边。 */
async function buildHost(build) {
  await build({
    name: `${PLUGIN_ID}/host`,
    cwd: PLUGIN_ROOT,
    entry: [resolve(PLUGIN_ROOT, 'src', 'index.js')],
    outDir: resolve(PLUGIN_ROOT, 'lib'),
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: false,
    // 包的 exports 指向 lib/index.js，产物名必须与之一致。
    outputOptions: { entryFileNames: 'index.js' },
  })
}

/** 构建浏览器半边（TS + JSX，入口为 src/client/index.ts）。 */
async function buildClient(build) {
  await build({
    name: `${PLUGIN_ID}/client`,
    cwd: PLUGIN_ROOT,
    entry: { client: resolve(PLUGIN_ROOT, 'src', 'client', 'index.ts') },
    outDir: resolve(PLUGIN_ROOT, 'lib'),
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: false,
    // 自动 JSX 运行时（react/jsx-runtime 已在基线模块表内）。
    jsx: 'automatic',
    // 共享模块保持外部引用；其余内部模块全部内联。
    deps: { neverBundle: BASELINE_MODULES },
    inputOptions: {
      resolve: {
        conditionNames: ['production', 'browser', 'import', 'module', 'default'],
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.MODE': JSON.stringify('production'),
      'import.meta.env': JSON.stringify({ MODE: 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  })
}

/** 源码入口存在性检查：防止构建静默产出空产物。 */
function assertSources() {
  for (const relative of ['src/index.js', 'src/client/index.ts']) {
    const file = resolve(PLUGIN_ROOT, relative)
    if (!existsSync(file)) throw new Error(`构建入口缺失：${file}`)
  }
}

assertSources()
const build = await loadTsdown()
await buildHost(build)
await buildClient(build)
console.log(`[${PLUGIN_ID}] 构建完成 → lib/index.js, lib/client.js`)
