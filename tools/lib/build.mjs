/**
 * 结构化输入任务插件的构建脚本。
 *
 * 产物（拆成组件后是四个）：
 *  - `lib/index.js`       host 聚合入口（装配两个组件）。
 *  - `lib/structured.js`  结构化提示词组件的 host 入口。
 *  - `lib/library.js`     提示词库组件的 host 入口。
 *  - `lib/client.js`      浏览器半边，CJS 闭包工厂，产物格式必须与 DSH 的动态 client bundle
 *                        契约一致：`window.__ModuleLoader__.load({ id, factory })`；
 *                        共享模块（react、cordis 等）通过注入的 require 解析，其余依赖内联。
 *
 * 三个 host 入口互不共享运行时（各自 import 自己的实现、各自内联），因此**每一个都必须零
 * import** —— `link:` 安装下 ESM 会 realpath 到源码目录，那里没有 node_modules。
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

/** host 侧入口：源码路径 → 产物文件名。 */
const HOST_ENTRIES = [
  { source: 'src/index.ts', output: 'index.js', suffix: 'host' },
  { source: 'src/components/structured/index.ts', output: 'structured.js', suffix: 'structured' },
  { source: 'src/components/library/index.ts', output: 'library.js', suffix: 'library' },
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

/**
 * 构建一个 host 入口（ESM，零 import 由测试断言）。
 * @param build - tsdown 的 build 函数。
 * @param entry - 入口描述。
 */
async function buildHostEntry(build, entry) {
  await build({
    name: `${PLUGIN_ID}/${entry.suffix}`,
    cwd: PLUGIN_ROOT,
    entry: [resolve(PLUGIN_ROOT, entry.source)],
    outDir: resolve(PLUGIN_ROOT, 'lib'),
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: false,
    // 包的 exports 指向这些文件名，产物名必须与之一致。
    outputOptions: { entryFileNames: entry.output },
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
  const required = [...HOST_ENTRIES.map(entry => entry.source), 'src/client/index.ts']
  for (const relative of required) {
    const file = resolve(PLUGIN_ROOT, relative)
    if (!existsSync(file)) throw new Error(`构建入口缺失：${file}`)
  }
}

assertSources()
const build = await loadTsdown()
for (const entry of HOST_ENTRIES) {
  await buildHostEntry(build, entry)
}
await buildClient(build)
console.log(`[${PLUGIN_ID}] 构建完成 → ${HOST_ENTRIES.map(entry => `lib/${entry.output}`).join(', ')}, lib/client.js`)
