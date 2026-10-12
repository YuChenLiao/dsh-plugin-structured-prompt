/**
 * 结构化提示词工具的行为测试（host 半边）。
 *
 * 重点不是"能返回字符串"，而是三条**契约**：
 *  1. 工具与客户端表单产出的提示词**完全一致** —— 两个入口共用 `shared/prompt.ts`，
 *     这条断言防止将来有人在工具里另写一套拼装；
 *  2. 模板作为默认值、调用参数覆盖它，且空串/空数组算"未给"；
 *  3. `goal` 是 schema 层强制的必填项（不是靠运行时兜底）。
 *
 * 用法：node --import tsx --import ./tools/lib/loader-hook.mjs tests/test-tool.mjs
 */
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const toolModule = await import(pathToFileURL(resolve(SRC, 'host', 'tool.ts')).href)
const prompt = await import(pathToFileURL(resolve(SRC, 'shared', 'prompt.ts')).href)
const { completeForm } = await import(pathToFileURL(resolve(SRC, 'shared', 'forms.ts')).href)
const { TEMPLATES } = await import(pathToFileURL(resolve(SRC, 'shared', 'templates.ts')).href)

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : `\n      ${detail}`}`)
  if (!ok) failed += 1
}

// defineTool 在构造时会编译并校验 schema：这一步抛错本身就是失败信号。
let definition
try {
  definition = toolModule.createStructuredPromptTool()
} catch (error) {
  console.error('FAIL  createStructuredPromptTool() 抛错：', error)
  process.exit(1)
}

/**
 * 调用工具。默认补上必填的 `role`，让各段断言能聚焦在被测字段上。
 * @param args - 工具参数（可覆盖默认 role）。
 * @returns 工具的 canonical 值。
 */
const run = (args) => definition.execute({ role: '一名严谨的工程师', ...args })

// ---- 1) 定义契约 ----

check('工具名正确', definition.name === toolModule.STRUCTURED_PROMPT_TOOL,
  String(definition.name))
check('描述为模型视角且提到 subagent',
  typeof definition.description === 'string'
  && definition.description.includes('subagent')
  && definition.description.includes('prompt'))
check('参数 schema 是标准 JSON Schema（含 required 数组）',
  definition.parameters.type === 'object' && typeof definition.parameters.properties === 'object')
// 与表单同一条规则：身份与目标必填。这是产品决策（表单里就是这两项必填），
// 工具侧不放松 —— 否则两个入口对"什么算可提交的提示词"会有两套标准。
check('role 与 goal 是必填参数',
  [...(definition.parameters.required ?? [])].sort().join(',') === 'goal,role',
  JSON.stringify(definition.parameters.required))

const properties = definition.parameters.properties
check('暴露全部表单字段（+ template）',
  ['goal', 'role', 'template', 'background', 'success_criteria', 'rules', 'forbidden',
    'tool_policy', 'callable_tools', 'tool_guidance', 'tool_failure', 'output_format',
    'output_spec', 'language_tone', 'fields', 'fallback', 'examples']
    .every(key => key in properties),
  Object.keys(properties).join(', '))
check('template 的 enum 覆盖全部内置模板',
  TEMPLATES.every(item => (properties.template.enum ?? []).includes(item.id)))
check('output_format 的 enum 覆盖全部骨架格式',
  Object.keys(prompt.OUTPUT_FORMAT_SKELETONS)
    .every(key => (properties.output_format.enum ?? []).includes(key)))

// ---- 2) 与客户端表单产出的提示词一致 ----

const args = {
  goal: '审查这次改动',
  role: '严格的高级工程师',
  background: '仓库在 D:\\work',
  rules: ['只审查本次改动', '每条问题给出行号'],
  forbidden: ['不要提风格偏好'],
  output_format: 'json',
  fallback: '数据不足时返回空数组',
}
const produced = await definition.execute(args)
const expected = prompt.buildSystemPrompt(completeForm({
  role: '严格的高级工程师',
  goal: '审查这次改动',
  background: '仓库在 D:\\work',
  rules: ['只审查本次改动', '每条问题给出行号'],
  forbidden: ['不要提风格偏好'],
  outputFormat: 'json',
  // 与 OutputSection.pickFormat 一致：选了格式就补骨架。
  outputSpec: prompt.OUTPUT_FORMAT_SKELETONS.json,
  fallback: '数据不足时返回空数组',
}))
check('工具产出与客户端表单逐字一致', produced.prompt === expected,
  produced.prompt === expected ? '' : `\n--- 工具 ---\n${produced.prompt}\n--- 表单 ---\n${expected}`)
check('选了 output_format 就补上格式骨架',
  produced.prompt.includes(prompt.OUTPUT_FORMAT_SKELETONS.json.slice(0, 20)))

// 手写的格式说明不被骨架冲掉（与客户端同一规则）。
const handwritten = await run({
  goal: 'x',
  output_format: 'json',
  output_spec: '自己写的契约',
})
check('手写的 output_spec 不被骨架覆盖', handwritten.prompt.includes('自己写的契约'))

// ---- 3) 只填两项必填也能工作 ----

const minimal = await run({ goal: '把这次改动写成一段说明' })
check('只填必填两项也能产出提示词', minimal.prompt.includes('把这次改动写成一段说明'))
check('必填齐备时无缺失项', minimal.missing.length === 0, minimal.missing.join(', '))
check('未用模板时 template 为空串', minimal.template === '')
// 必填在**参数边界**就被拒绝：narrowArgs 在进入构建逻辑之前完成类型与枚举校验。
let rejected = null
try {
  await definition.execute({ goal: 'x' })
} catch (error) {
  rejected = error
}
check('缺 role 的调用被参数校验拒绝',
  rejected !== null && /role/.test(String(rejected?.message ?? rejected)),
  String(rejected?.message ?? rejected))

// 越界枚举也在参数边界拒绝：否则它会带着 schema 外的取值进入构建，下游只能静默降级
// （骨架查不到 → 输出格式段少一段），而模型收到的却是"成功"。
let badEnum = null
try {
  await run({ goal: 'x', output_format: 'csv' })
} catch (error) {
  badEnum = error
}
check('越界的 output_format 被参数校验拒绝',
  badEnum !== null && /output_format/.test(String(badEnum?.message ?? badEnum)),
  String(badEnum?.message ?? badEnum))

// ---- 4) 模板：作默认值，调用参数覆盖 ----

const firstTemplate = TEMPLATES[0]
const fromTemplate = await run({ goal: '覆盖后的目标', template: firstTemplate.id })
check('template 字段回传所用模板 id', fromTemplate.template === firstTemplate.id)
check('调用参数覆盖模板的 goal', fromTemplate.prompt.includes('覆盖后的目标'))
check('模板的其它字段作为默认值保留',
  (() => {
    const base = firstTemplate.build()
    // 调用参数只给了 role 与 goal，模板的其余非空字段都应原样出现在成稿里。
    const kept = [base.outputSpec, base.fallback, ...base.rules, ...base.forbidden, ...base.toolGuidance]
      .filter(value => value !== '')
    return kept.length > 0
      && kept.every(value => fromTemplate.prompt.includes(value.trim().split('\n')[0]))
  })())

// 空串与空数组视为"未给"：模板给了规则时，传 [] 不该把它清空。
const templateForm = firstTemplate.build()
if (templateForm.rules.length > 0) {
  const emptied = await run({ goal: 'x', template: firstTemplate.id, rules: [] })
  const filled = await run({ goal: 'x', template: firstTemplate.id })
  check('空数组不覆盖模板的规则', emptied.prompt === filled.prompt)
} else {
  const emptied = await run({ goal: 'x', rules: [], role: '' })
  check('空数组/空串视为未给', !emptied.prompt.includes('## 身份'))
}

// ---- 5) callable_tools 的名字与用途拆分配对 ----

const manual = await run({
  goal: '拉指标',
  tool_policy: 'manual',
  callable_tools: ['query_metrics: 拉取指标', 'read_log'],
})
check('手动策略写入逐行工具清单', manual.prompt.includes('query_metrics'))
check('工具用途被拆出并配对', manual.prompt.includes('拉取指标'))
check('未写用途的工具名仍然保留', manual.prompt.includes('read_log'))
check('手动策略下不出现"由你自行判断"',
  !manual.prompt.includes('自行判断'))

// ---- 6) render：直接给出提示词正文 ----

const rendered = definition.output.render(args, produced)
check('render 返回单个 text block', rendered.length === 1 && rendered[0].type === 'text')
check('render 输出提示词正文', rendered[0].text === produced.prompt)
check('output schema 声明了 prompt/template/missing',
  ['prompt', 'template', 'missing'].every(key => key in definition.output.schema.properties))

// 缺失必填时 render 追加提示（execute 的 schema 校验在 registry 层，这里直接构造值）。
const withMissing = definition.output.render(args, { ...produced, missing: ['goal'] })
check('有缺失字段时 render 追加说明',
  withMissing[0].text.includes('goal') && withMissing[0].text.length > produced.prompt.length)

// ---- 7) 注册面 ----

const registered = []
const disposer = toolModule.registerStructuredPromptTool({
  tools: { register: (tool) => { registered.push(tool); return () => {} } },
})
check('registerStructuredPromptTool 注册了一个工具', registered.length === 1)
check('注册的正是本工具', registered[0]?.name === toolModule.STRUCTURED_PROMPT_TOOL)
check('返回取消注册函数', typeof disposer === 'function')

if (failed > 0) {
  console.error(`\n${failed} 项工具测试未通过。`)
  process.exit(1)
}
console.log('\n全部工具测试通过。')
