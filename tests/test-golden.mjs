/**
 * 黄金文件回归：把 `tests/golden/cases.mjs` 的每个用例构建一遍，与同目录的期望文件
 * `<id>.txt` **逐字**比对。
 *
 * 这是提示词格式的契约防线。手写断言只覆盖"想得到的场景"，而构建器的输出是用户会
 * 保存、导出、并交给子代理的东西 —— 它一旦漂移，影响面很宽。
 *
 * 更新期望文件（**生成后务必打开核对**）：
 *   node tests/test-golden.mjs --update
 *
 * 用法：node --import tsx --import ./tools/lib/loader-hook.mjs tests/test-golden.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN_DIR = join(HERE, 'golden')
const SRC = resolve(HERE, '..', 'src', 'shared')

const { buildSystemPrompt } = await import(pathToFileURL(resolve(SRC, 'prompt.ts')).href)
const { completeForm } = await import(pathToFileURL(resolve(SRC, 'forms.ts')).href)
const { TEMPLATES } = await import(pathToFileURL(resolve(SRC, 'templates.ts')).href)
const { CASES } = await import(pathToFileURL(join(GOLDEN_DIR, 'cases.mjs')).href)

const update = process.argv.includes('--update')

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : `\n${detail}`}`)
  if (!ok) failed += 1
}

/** 用例 → 提示词。 */
function buildFor(testCase) {
  const template = testCase.template === undefined
    ? undefined
    : TEMPLATES.find(item => item.id === testCase.template)
  if (testCase.template !== undefined && template === undefined) {
    throw new Error(`未知模板 id：${testCase.template}`)
  }
  const base = template === undefined ? {} : template.build()
  return buildSystemPrompt(completeForm({ ...base, ...(testCase.patch ?? {}) }))
}

console.log(`黄金用例 ${CASES.length} 条${update ? '（更新模式）' : ''}\n`)

const expectedIds = new Set(CASES.map(item => `${item.id}.txt`))

for (const testCase of CASES) {
  const actual = buildFor(testCase)
  const file = join(GOLDEN_DIR, `${testCase.id}.txt`)

  if (update) {
    writeFileSync(file, actual)
    console.log(`WROTE ${testCase.id}.txt  (${testCase.note})`)
    continue
  }
  if (!existsSync(file)) {
    check(`${testCase.id}：期望文件存在`, false, `缺少 ${file}；用 --update 生成后核对`)
    continue
  }
  const expected = readFileSync(file, 'utf8')
  check(`${testCase.id}：${testCase.note}`, actual === expected,
    actual === expected ? '' : `--- 期望 ---\n${expected}\n--- 实际 ---\n${actual}`)
}

// 反向检查：期望目录里不该有孤立的文件（用例删了但文件还在）。
if (!update) {
  const orphans = readdirSync(GOLDEN_DIR)
    .filter(name => name.endsWith('.txt') && !expectedIds.has(name))
  check('没有孤立的期望文件', orphans.length === 0, orphans.join(', '))
}

if (update) {
  console.log('\n期望文件已写出 —— 请打开核对内容再提交。')
  process.exit(0)
}
if (failed > 0) {
  console.error(`\n${failed} 项黄金比对未通过。`)
  process.exit(1)
}
console.log('\n全部黄金比对通过。')
