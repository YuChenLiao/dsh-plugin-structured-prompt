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
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { basename, dirname, resolve } from 'node:path'

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

/**
 * 载入 DSH 源码树里的 lightningcss —— 与 DSH 官方客户端包**同一个 CSS 编译器**，
 * 因此本插件不需要自己的 CSS 依赖，产物形态（编译 + 注入）也与官方一致。
 * @returns lightningcss 的 `transform` 函数。
 */
async function loadLightningcss() {
  const entry = resolve(HARNESS_ROOT, 'node_modules', 'lightningcss', 'node', 'index.js')
  if (!existsSync(entry)) {
    throw new Error(`未找到 lightningcss：${entry}；请用 DSH_SOURCE_ROOT 指向 DSH 源码树`)
  }
  const mod = await import(pathToFileURL(entry).href)
  if (typeof mod.transform !== 'function') {
    throw new Error(`lightningcss 未导出 transform()：${entry}`)
  }
  return mod.transform
}

/**
 * 虚拟 id 前缀。
 *
 * 后缀刻意**不是** `.css`：tsdown 自己的 CSS 管道匹配以 `.css` 结尾的 id，虚拟 id 一旦那样结尾
 * 就会被它接管（DSH 官方实现同样这么做）。
 */
const CSS_MODULE_VIRTUAL_PREFIX = '\u0000css-module:'
const CSS_GLOBAL_VIRTUAL_PREFIX = '\u0000css-global:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * 生成「注入样式」模块：一个幂等的 `<style>` 注入，外加（`*.module.css` 时）hashed class 映射。
 *
 * 幂等靠 `data-plugin-css` 标记：同一份样式被加载两次也只注入一个标签 —— 这段逻辑以前是手写的
 * `installStyles` effect（连同一个 `ctx.effect` 生命周期），现在由构建产物承担，插件入口因此
 * 不必再关心样式注入。
 * @param pluginId - 插件 id（写入 `data-plugin`）。
 * @param fileId - 样式文件绝对路径（生成标签标记并据此去重）。
 * @param css - 编译后的 CSS 文本。
 * @param classMap - `*.module.css` 的 class 映射；全局 CSS 时为 `undefined`。
 * @returns 模块源码。
 */
function styleInjectionModule(pluginId, fileId, css, classMap) {
  const tagId = `${pluginId}/${basename(fileId)}`
  const lines = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== \'undefined\''
    + " && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`,
  ]
  return lines.join('\n')
}

/**
 * CSS 插件：`*.module.css` → hashed class map + 注入；`*.css` → 全局注入。
 *
 * 样式因此写在真正的 `.css` 文件里由构建期编译，而不是 JS 模板字符串或内联样式对象。
 * @param transform - lightningcss 的 `transform`。
 * @param pluginId - 插件 id。
 * @returns rolldown/tsdown 插件对象。
 */
function cssPlugin(transform, pluginId) {
  /** 虚拟 id → 物理文件与类型。 */
  const parseId = (id) => {
    const isModule = id.startsWith(CSS_MODULE_VIRTUAL_PREFIX)
    const isGlobal = id.startsWith(CSS_GLOBAL_VIRTUAL_PREFIX)
    if (!isModule && !isGlobal) return undefined
    const prefix = isModule ? CSS_MODULE_VIRTUAL_PREFIX : CSS_GLOBAL_VIRTUAL_PREFIX
    return { isModule, fileId: id.slice(prefix.length, -CSS_VIRTUAL_SUFFIX.length) }
  }
  return {
    name: `${pluginId}-css-inline`,
    resolveId(source, importer) {
      const isModule = source.endsWith('.module.css')
      if (!isModule && !source.endsWith('.css')) return null
      const absolute = importer === undefined
        ? resolve(PLUGIN_ROOT, source)
        : resolve(dirname(importer), source)
      const prefix = isModule ? CSS_MODULE_VIRTUAL_PREFIX : CSS_GLOBAL_VIRTUAL_PREFIX
      return prefix + absolute + CSS_VIRTUAL_SUFFIX
    },
    async load(id) {
      const parsed = parseId(id)
      if (parsed === undefined) return null
      // 虚拟 id 会挡住 rolldown 对物理样式文件的依赖追踪，显式登记为 watch 依赖。
      this.addWatchFile(parsed.fileId)
      const code = await readFile(parsed.fileId)
      const result = transform({
        filename: parsed.fileId,
        code,
        cssModules: parsed.isModule ? { pattern: '[hash]_[local]' } : false,
        minify: true,
      })
      const classMap = parsed.isModule
        ? Object.fromEntries(Object.entries(result.exports ?? {}).map(([local, entry]) => [local, entry.name]))
        : undefined
      return styleInjectionModule(pluginId, parsed.fileId, result.code.toString(), classMap)
    },
  }
}

/** 构建浏览器半边（TS + JSX + CSS，入口为 src/client/index.ts）。 */
async function buildClient(build, transform) {
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
    // 样式：`.css` / `.module.css` 由 lightningcss 编译成注入模块（见 cssPlugin）。
    plugins: [cssPlugin(transform, PLUGIN_ID)],
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
const transform = await loadLightningcss()
for (const entry of HOST_ENTRIES) {
  await buildHostEntry(build, entry)
}
await buildClient(build, transform)
console.log(`[${PLUGIN_ID}] 构建完成 → ${HOST_ENTRIES.map(entry => `lib/${entry.output}`).join(', ')}, lib/client.js`)
