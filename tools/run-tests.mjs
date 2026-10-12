/**
 * 一次跑完四套验证：类型检查 → 提示词行为 → 注册契约 → 渲染结构 → 安装产物。
 *
 * 源码是 TypeScript（`.ts`/`.tsx`），测试直接跑源码而不是产物，所以需要：
 *  - `tsx` 提供 TS/TSX 转译（DSH 源码树里已安装，本工程不引入依赖）；
 *  - `TSX_TSCONFIG_PATH` 显式指定本工程的 tsconfig，让 `jsx: "react-jsx"` 生效
 *    （否则 tsx 会退回 `React.createElement`，运行时抛 `React is not defined`）；
 *  - `tools/lib/loader-hook.mjs` 把 `@deepseek-ai/dsh-client-store` 指向本地桩，
 *    并把相对 `.js` 说明符映射到 `.ts`/`.tsx` 源。
 *
 * 用法：node tools/run-tests.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const HARNESS_ROOT = process.env.DSH_SOURCE_ROOT ?? 'D:\\dsh\\deepseek-harness'
const TSX_LOADER = pathToFileURL(
  join(HARNESS_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs'),
).href
const HOOK = pathToFileURL(join(HERE, 'lib', 'loader-hook.mjs')).href
const TSC = join(HARNESS_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

/** 每套验证：名称、脚本、是否需要 TS 加载链。 */
const SUITES = [
  { name: '类型检查', script: TSC, args: ['--noEmit', '-p', join(ROOT, 'tsconfig.json')], ts: false },
  { name: '提示词行为', script: join(ROOT, 'tests', 'test-prompt.mjs'), ts: true },
  { name: '注册契约', script: join(ROOT, 'tests', 'test-registration.mjs'), ts: true },
  { name: '渲染结构', script: join(ROOT, 'tests', 'test-render.mjs'), ts: true },
  { name: '工具行为', script: join(ROOT, 'tests', 'test-tool.mjs'), ts: true },
  // verify-install 也走加载链：它要真正 import host 产物，而产物 import 的
  // `@deepseek-ai/dsh-tools` 只有靠 loader-hook 才能解析到。
  { name: '安装产物', script: join(ROOT, 'tests', 'verify-install.mjs'), ts: true },
]

let failed = 0
for (const suite of SUITES) {
  if (!existsSync(suite.script)) {
    console.error(`FAIL  ${suite.name}：找不到 ${suite.script}`)
    failed += 1
    continue
  }
  const args = suite.ts
    ? ['--import', TSX_LOADER, '--import', HOOK, suite.script, ...(suite.args ?? [])]
    : [suite.script, ...(suite.args ?? [])]
  console.log(`\n===== ${suite.name} =====`)
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, TSX_TSCONFIG_PATH: join(ROOT, 'tsconfig.json') },
  })
  if (result.status !== 0) failed += 1
}

if (failed > 0) {
  console.error(`\n${failed} 套验证未通过。`)
  process.exit(1)
}
console.log('\n全部验证通过。')
