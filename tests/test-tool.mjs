/**
 * 结构化提示词工具的行为测试（host 半边）。
 *
 * 重点不是"能返回字符串"，而是三条**契约**：
 *  1. 工具与客户端表单产出的提示词**完全一致** —— 两个入口共用 `shared/prompt.ts`，
 *     这条断言防止将来有人在工具里另写一套拼装；
 *  2. 模板作为默认值、调用参数覆盖它，且空串/空数组算"未给"；
 *  3. `goal` 与 `role` 是必填项：参数 schema 标记了 `required`，**参数边界**再校验一次
 *     （`narrowArgs`），因为手工构造的定义不经过 `defineTool` 的编译期校验。
 *
 * 用法：node --import tsx --import ./tools/lib/loader-hook.mjs tests/test-tool.mjs
 */
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const toolModule = await import(pathToFileURL(resolve(SRC, 'host', 'tool.ts')).href)
const prompt = await import(pathToFileURL(resolve(SRC, 'shared', 'prompt.ts')).href)
const { completeForm, createEmptyForm } = await import(
  pathToFileURL(resolve(SRC, 'shared', 'forms.ts')).href
)
const { TEMPLATES } = await import(pathToFileURL(resolve(SRC, 'shared', 'templates.ts')).href)
const { resolveProviderName, runForeground } = await import(
  pathToFileURL(resolve(SRC, 'host', 'subagents.ts')).href
)
// 参数边界与纯构建：多处断言直接调用它们，所以在文件顶部 import。
const argsModule = await import(pathToFileURL(resolve(SRC, 'host', 'args.ts')).href)
const { buildFromArgs, resolveCallableTools } = await import(
  pathToFileURL(resolve(SRC, 'host', 'build.ts')).href
)

/** 一个立即 settle 的假子代理运行。 */
function fakeRun(id, result, onDispose) {
  return {
    id,
    result: Promise.resolve(result),
    dispose: async () => { onDispose() },
  }
}

/** 造一个只有单个 provider 的假子代理服务。 */
function fakeSubagents(makeRun) {
  return {
    list: () => ['only'],
    getProvider: name => (name === 'only' ? { name } : undefined),
    start: async () => makeRun(),
  }
}

/**
 * 同上，但把每次 `start()` 的请求记下来。
 *
 * 用来断言"传给子代理的东西"（标签、取消信号）—— 只看返回值无法区分默认值与传入值。
 * @param record - 收集 `{ name, request }` 的数组。
 * @returns 假子代理服务。
 */
function recordingSubagents(record) {
  return {
    list: () => ['only'],
    getProvider: name => (name === 'only' ? { name } : undefined),
    start: async (name, request) => {
      record.push({ name, request })
      return fakeRun('child-rec', {
        output: [{ type: 'text', text: 'ok' }],
        stopReason: 'completed',
      }, () => {})
    },
  }
}

/** 捕获一次调用的错误。 */
async function rejectionOf(fn) {
  try {
    await fn()
    return null
  } catch (error) {
    return error
  }
}

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : `\n      ${detail}`}`)
  if (!ok) failed += 1
}

// 定义是手工构造的（不经过 `defineTool`）：构造这一步抛错本身就是失败信号。
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
// schema 的 `required` 刻意保留：它表达期望（模型该尽量给出身份与目标），而实现在模板在场时容忍
// 缺失 —— 两者不是矛盾，是"宽进严出"（见 6g 与 README 的取舍列表）。
check('schema 仍声明 role / goal 必填（表达期望，实现在模板在场时容忍缺失）',
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
// 只给 id 枚举，模型无从挑选；场景必须进 schema 且与 id 配对 —— 后者也是**常驻**成本。
check('template 描述里带出每套模板的「id: 场景」配对',
  TEMPLATES.every(item => String(properties.template.description ?? '').includes(`${item.id}: ${item.whenToUse}`)))
// 「`delegate` 是可选路径、首轮慎用」是这一批的产品决策，用断言钉住它不被改回"更省 token"的口吻。
// 注意：断言覆盖**子字段**的描述，否则「总是用这个 provider」这类默认语气可以从 `provider` 里溜回去。
const delegateText = [
  properties.delegate.description,
  properties.delegate.properties?.provider?.description,
].map(value => String(value ?? '')).join(' ')
check('delegate 描述钉住「可选」与「首轮风险」，且不含默认/优先措辞',
  delegateText.startsWith('Optional')
  && delegateText.includes('first turn')
  && !/\balways\b|\bby default\b|\bprefer\b|\buse it first\b/i.test(delegateText),
  delegateText.slice(0, 140))
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

// 参数边界的类型校验：不合规输入必须在边界**报错**而不是静默丢弃 —— 否则模型收到的是
// "成功"，却拿到一份少了半截约束的提示词（实测 `rules: 'not-an-array'`、`background: 42`、
// `tool_policy: 'maybe'`、`callable_tools: 'read_log'` 都会被静默丢弃；而数组里混入非字符串
// 更糟：它会以 `item.trim is not a function` 的形式在构建期崩掉）。
const boundaryErrors = [
  { label: 'rules 非数组', args: { role: 'r', goal: 'g', rules: 'not-an-array' }, field: 'rules' },
  { label: 'rules 含非字符串元素', args: { role: 'r', goal: 'g', rules: ['ok', 7] }, field: 'rules' },
  { label: 'background 非字符串', args: { role: 'r', goal: 'g', background: 42 }, field: 'background' },
  { label: 'tool_policy 越界', args: { role: 'r', goal: 'g', tool_policy: 'maybe' }, field: 'tool_policy' },
  { label: 'callable_tools 非数组', args: { role: 'r', goal: 'g', callable_tools: 'read_log' }, field: 'callable_tools' },
  { label: 'fields 含非字符串元素', args: { role: 'r', goal: 'g', fields: [null] }, field: 'fields' },
]
for (const item of boundaryErrors) {
  const error = await rejectionOf(() => definition.execute(
    item.args, { signal: new AbortController().signal },
  ))
  // 匹配到「字段名 must be」：只查字段名会撞上子串（`fields` 里含 `field`、`callable_tools`
  // 里含 `tool`），那样断言会在校验被删掉之后仍然通过。
  check(`${item.label} 在边界被拒`,
    error !== null && String(error.message).includes(`${item.field} must be`),
    String(error?.message ?? error))
}

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
const firstTemplateForm = firstTemplate.build()
const emptied = await run({ goal: 'x', template: firstTemplate.id, rules: [] })
const filled = await run({ goal: 'x', template: firstTemplate.id })
check('空数组不覆盖模板的规则（模板确有规则时）',
  firstTemplateForm.rules.length > 0 && emptied.prompt === filled.prompt,
  `模板规则 ${firstTemplateForm.rules.length} 条`)

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
check('render 输出提示词正文', rendered[0].text.startsWith(produced.prompt))
check('render 在正文后附上成本陈述（陈述事实，不是指令）',
  rendered[0].text.includes('replayed on every later step'),
  rendered[0].text.slice(produced.prompt.length, produced.prompt.length + 160))
check('output schema 声明了 prompt/template/missing',
  ['prompt', 'template', 'missing'].every(key => key in definition.output.schema.properties))

// 缺失必填时 render 追加提示（execute 的 schema 校验在 registry 层，这里直接构造值）。
const withMissing = definition.output.render(args, { ...produced, missing: ['goal'] })
check('有缺失字段时 render 追加说明',
  withMissing[0].text.includes('goal') && withMissing[0].text.length > produced.prompt.length)

// ---- 6b) 调用卡片 ----

check('提供 presentCall', typeof definition.presentCall === 'function')
const card = definition.presentCall?.({ goal: '审查本次改动', role: '严格的高级工程师' })
check('卡片标题取本次目标', card?.title === '审查本次改动', String(card?.title))
check('卡片是 generic 类型', card?.card === 'generic' && card?.kind === 'other')
check('卡片带上原始参数', card?.rawInput !== undefined)
check('缺 goal 时标题回退到工具名',
  definition.presentCall?.({})?.title === toolModule.STRUCTURED_PROMPT_TOOL)
check('goal 是空白时也回退',
  definition.presentCall?.({ goal: '   ' })?.title === toolModule.STRUCTURED_PROMPT_TOOL)
// presentCall 会用于历史回放，参数可能是旧形状：必须容错而不是抛错。
check('参数形状异常时不抛错', (() => {
  try {
    definition.presentCall?.(null)
    definition.presentCall?.('string')
    definition.presentCall?.({ goal: 123 })
    return definition.presentCall?.({ goal: 123 })?.title === toolModule.STRUCTURED_PROMPT_TOOL
  } catch {
    return false
  }
})())
// 结果是整段提示词：再写一份 presentResult 只会把同一段大文本塞进视图载荷。
check('不提供 presentResult（交给通用卡片读 durable 内容）',
  definition.presentResult === undefined)

// ---- 6c) 直投子代理 ----

check('参数表含 delegate', 'delegate' in properties)
check('输出 schema 含 delegated',
  definition.output.schema.properties.delegated !== undefined
  && definition.output.schema.required.includes('delegated'))
check('不委托时 delegated 为空串',
  (await run({ goal: 'g' })).delegated === '')

// provider 选择：靠"有默认值"而不是"多个候选就报错"。DSH 的 base bundle 同时注册 spawn 与
// fork，要求显式指定等于让功能开箱不可用。这段只测纯选择函数；装载行配置的优先级在 6f。
check('只有一个 provider 时自动选它', resolveProviderName(fakeSubagents(() => {}), undefined) === 'only')
check('显式指定可用 provider',
  resolveProviderName(fakeSubagents(() => {}), 'only') === 'only')
check('多个 provider 时默认选 spawn',
  resolveProviderName({ ...fakeSubagents(() => {}), list: () => ['fork', 'spawn'] }, undefined) === 'spawn')
check('没有 spawn 时取第一个',
  resolveProviderName({ ...fakeSubagents(() => {}), list: () => ['fork', 'acp'] }, undefined) === 'fork')
check('provider 名先 trim 再比较',
  resolveProviderName({ ...fakeSubagents(() => {}), list: () => ['spawn '] }, undefined) === 'spawn')
check('显式指定时也 trim',
  resolveProviderName(fakeSubagents(() => {}), ' only ') === 'only')
const noneError = await rejectionOf(async () => {
  resolveProviderName({ ...fakeSubagents(() => {}), list: () => [] }, undefined)
})
check('没有 provider 时报错',
  noneError !== null && noneError.message.includes('no subagent provider'), String(noneError?.message))
const unknownError = await rejectionOf(async () => {
  resolveProviderName(fakeSubagents(() => {}), 'nope')
})
check('指定不存在的 provider 时报错并列出可用值',
  unknownError !== null && unknownError.message.includes('only'), String(unknownError?.message))

// 前台 run：成功路径
let disposed = false
const okOutcome = await runForeground(
  fakeSubagents(() => fakeRun('child-1', {
    output: [{ type: 'text', text: 'done' }, { type: 'text', text: '!' }],
    stopReason: 'completed',
  }, () => { disposed = true })),
  'only', 'the prompt', 'label', { id: 'agent' }, new AbortController().signal,
)
check('成功路径拼接全部文本块', okOutcome.output === 'done!', okOutcome.output)
check('成功后释放了子代理运行', disposed === true)

// 前台 run：非 completed 终态算失败，但部分输出要带上，且仍然释放运行
let disposedOnFailure = false
const failedRun = await rejectionOf(() => runForeground(
  fakeSubagents(() => fakeRun('child-2', {
    output: [{ type: 'text', text: 'partial answer' }],
    stopReason: 'max-tokens',
  }, () => { disposedOnFailure = true })),
  'only', 'p', 'l', { id: 'agent' }, new AbortController().signal,
))
check('非 completed 终态抛错', failedRun !== null && failedRun.message.includes('token limit'),
  String(failedRun?.message))
check('失败说明带上部分输出', String(failedRun?.message).includes('partial answer'))
check('失败路径也释放了运行', disposedOnFailure === true)

// 工具层：没有 subagents 服务时要说清替代做法（而不是静默失败）
const noService = await rejectionOf(() => definition.execute(
  { role: 'r', goal: 'g', delegate: {} },
  { signal: new AbortController().signal, agent: { id: 'agent' } },
))
check('没有 subagents 服务时 delegate 被拒并指出替代做法',
  noService !== null && noService.message.includes('subagents') && noService.message.includes('without `delegate`'),
  String(noService?.message))

const withService = toolModule.createStructuredPromptTool({
  tools: { register: () => () => {} },
  get: name => (name === 'subagents'
    ? fakeSubagents(() => fakeRun('child-3', {
      output: [{ type: 'text', text: 'child output' }],
      stopReason: 'completed',
    }, () => {}))
    : undefined),
})
const noAgent = await rejectionOf(() => withService.execute(
  { role: 'r', goal: 'g', delegate: {} },
  { signal: new AbortController().signal },
))
check('没有 owning agent 时 delegate 被拒',
  noAgent !== null && noAgent.message.includes('no owning agent'), String(noAgent?.message))

const delegated = await withService.execute(
  { role: '审查员', goal: '审查本次改动', delegate: { label: 'review' } },
  { signal: new AbortController().signal, agent: { id: 'agent' } },
)
check('委托时返回子代理输出', delegated.delegated === 'child output', delegated.delegated)
check('委托时仍回传构建好的提示词', delegated.prompt.includes('审查本次改动'))
const delegatedRender = withService.output.render(null, delegated)
check('委托时 render 说明提示词未进入本上下文',
  delegatedRender[0].text.includes('not added to this context')
  && delegatedRender[0].text.includes('child output'))
check('delegation 标记含 provider / 子会话 / 终态',
  delegated.delegation.includes('only/'), delegated.delegation)
check('未委托时 delegation 为空串', (await run({ goal: 'g' })).delegation === '')

// 子代理**正常完成但没有文本输出**（只调用了工具）：delegated 合法地为空串，
// 此时必须靠 delegation 区分"静默的子代理"与"根本没委托" —— 否则会回退成未委托分支，
// 把整段提示词灌回本上下文，正好违背 delegate 的承诺。
const silentTool = toolModule.createStructuredPromptTool({
  tools: { register: () => () => {} },
  get: name => (name === 'subagents'
    ? fakeSubagents(() => fakeRun('child-silent', {
      output: [{ type: 'image', attachment: {} }],
      stopReason: 'completed',
    }, () => {}))
    : undefined),
})
const silent = await silentTool.execute(
  { role: '审查员', goal: '审查本次改动', delegate: {} },
  { signal: new AbortController().signal, agent: { id: 'agent' } },
)
check('子代理无文本输出时 delegated 为空串', silent.delegated === '')
check('但 delegation 非空', silent.delegation !== '', silent.delegation)
const silentRender = silentTool.output.render(null, silent)[0].text
check('render 仍走委托分支', silentRender.includes('Delegated to a subagent'))
check('render 不把提示词灌回上下文', !silentRender.includes('审查本次改动'))
check('render 说明子代理没有文本输出', silentRender.includes('no text output'))

// `delegate.label` 为空串或纯空白时按「未给」处理，与参数边界的其它字段一致 —— 空串
// 不该变成子代理的空标签。这一条要用记录请求的假服务才看得见：返回值里根本没有 label。
const recorded = []
const recordedService = () => toolModule.createStructuredPromptTool({
  tools: { register: () => () => {} },
  get: name => (name === 'subagents' ? recordingSubagents(recorded) : undefined),
})
/**
 * 跑一次委托，返回传给子代理的标签。
 *
 * 取最后一次记录（而不是固定下标）：将来在中间插入用例时不会错位成假失败。
 * @param delegate - delegate 参数。
 * @returns 子代理收到的 label。
 */
const labelSentToChild = async (delegate) => {
  await recordedService().execute(
    { role: 'r', goal: 'g', delegate },
    { signal: new AbortController().signal, agent: { id: 'agent' } },
  )
  return recorded.at(-1)?.request.label
}
check('delegate.label 为空串时回退到默认标签',
  (await labelSentToChild({ label: '' })) === toolModule.STRUCTURED_PROMPT_TOOL)
check('delegate.label 为纯空白时也回退到默认标签',
  (await labelSentToChild({ label: '   ' })) === toolModule.STRUCTURED_PROMPT_TOOL)
check('显式 label 原样传给子代理（不 trim，标签是展示用的）',
  (await labelSentToChild({ label: '  review  ' })) === '  review  ')

// ---- 6d) 「未给」只有一条判定，且工具名与用途整组同进同退 ----
//
// 判定在 `prefer` / `isProvidedList` 里（共用同一个 `isBlankItem`）。用能观测的字段锁住
// 它：若判定退回"只看数组长度"，`rules: ['']` 会把模板的规则整组清掉。工具清单那条不变量
// 在产物上不可观测（内置模板都不带清单），所以直接测选清单的纯函数。
const blankRules = (() => {
  const base = { role: 'r', goal: 'g', template: 'code-review' }
  return {
    none: buildFromArgs(argsModule.narrowArgs(base)).prompt,
    blank: buildFromArgs(argsModule.narrowArgs({ ...base, rules: [''] })).prompt,
  }
})()
check('全空白的 rules 与未给等价（模板规则不被清掉）', blankRules.blank === blankRules.none)

// 两个判空入口必须同源：一个回退时另一个必须判为「未给」，否则将来改规则只会生效一半。
const SENTINEL = ['<fallback>']
check('prefer 与 isProvidedList 的判空同源',
  [undefined, [], [''], ['   '], ['', 'a'], [': x'], ['a']].every(items =>
    (argsModule.prefer(items, SENTINEL) === SENTINEL) === !argsModule.isProvidedList(items)))

// 带清单的底座：四套内置模板都不带，只能在这里构造（理由见 `resolveCallableTools`）。
const baseWithList = { ...createEmptyForm(), callableTools: ['base_tool'], toolSlots: ['底座用途'] }
/**
 * 选定生效的工具清单。
 * @param entries - `callable_tools` 的原始取值。
 * @returns `{ callableTools, toolSlots }`。
 */
const resolveTools = (entries) => resolveCallableTools(
  entries, argsModule.splitCallableTools(entries ?? []), baseWithList,
)
check('未给清单时两个字段都回退底座',
  resolveTools(undefined).callableTools.join() === 'base_tool'
  && resolveTools(undefined).toolSlots.join() === '底座用途')
check('全空白清单整组回退底座',
  resolveTools(['  ']).callableTools.join() === 'base_tool'
  && resolveTools(['  ']).toolSlots.join() === '底座用途')
check('拆分后工具名为空时仍整组取调用参数（用途不会回到别的工具上）',
  resolveTools([': 用途']).callableTools.join() === ''
  && resolveTools([': 用途']).toolSlots.join() === '用途',
  JSON.stringify(resolveTools([': 用途'])))
check('给了有效工具时两个字段都取调用参数',
  resolveTools(['a: p']).callableTools.join() === 'a'
  && resolveTools(['a: p']).toolSlots.join() === 'p')
check('每套内置模板的工具名与用途等长（将来给模板加清单时的第一道防线）',
  TEMPLATES.every((template) => {
    const built = template.build()
    return built.callableTools.length === built.toolSlots.length
  }))

/**
 * 取提示词里「工具使用策略」段的内容。
 * @param text - 提示词全文。
 * @returns 该段正文；没有这一段时为空串。
 */
const toolPolicySection = (text) => (text.split('\n# 工具使用策略\n')[1] ?? '').split('\n# ')[0] ?? ''
// 下游：以冒号开头的条目（工具名为空）必须整行忽略，否则会写出一个名叫「: 拉取指标」的
// 工具。断言只看策略段，避免被其它段落里的同名字样代偿。
const colonEntry = await run({ goal: 'g', tool_policy: 'manual', callable_tools: [': 拉取指标'] })
check('冒号开头的条目不出现在产物里', !toolPolicySection(colonEntry.prompt).includes('拉取指标'))
const mixedTools = await run({
  goal: 'g', tool_policy: 'manual', callable_tools: [': 用途', 'read_log: 读日志'],
})
check('空工具名的行被忽略、同组其它行的用途仍然配对',
  toolPolicySection(mixedTools.prompt).includes('- read_log：读日志')
  && !toolPolicySection(mixedTools.prompt).includes('用途'),
  toolPolicySection(mixedTools.prompt))
// 守卫对象是下游「没有有效工具就不产出策略头」这条短路，不是判空本身。
const blankTools = await run({ goal: 'g', tool_policy: 'manual', callable_tools: [''] })
check('全空白的 callable_tools 不产生策略行',
  !toolPolicySection(blankTools.prompt).includes('只允许调用下列已指定的工具'))

// ---- 6e) 委托的失败路径 ----
//
// `delegate` 的收尾规则是"照官方实现"：结果与 `dispose()` 并行 settle，两者都失败时抛
// `AggregateError`，非 `completed` 的终态一律算失败但带上诊断与部分输出。这些分支此前
// 只覆盖了 max-tokens 一种，其余靠读代码相信 —— 失败路径恰恰是最少被真人走到的地方。

/**
 * 造一个结果与释放都可控的假运行。
 * @param id - 子会话 id。
 * @param result - 终态结果；传 `Error` 表示运行本身被拒绝。
 * @param disposeError - 传了就表示释放失败。
 * @returns 假运行。
 */
const failingRun = (id, result, disposeError) => ({
  id,
  result: result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  dispose: disposeError === undefined ? async () => {} : async () => { throw disposeError },
})

/**
 * 用固定的假运行跑一次前台委托。
 *
 * 注意：`fakeSubagents` 忽略参数、每次 `start` 返回**同一个** run 对象，所以每个用例只跑
 * 一次 —— `run.result` 是一次性 promise，重复跑会失真。
 * @param run - 假运行。
 * @returns `runForeground` 的 promise。
 */
const runWith = (run) => runForeground(
  fakeSubagents(() => run), 'only', 'p', 'l', { id: 'agent' }, new AbortController().signal,
)

// 终态 → 错误信息的形状：未知终态也按失败处理，而不是把部分输出当成成功。
for (const [stopReason, expected] of [
  ['aborted', 'was cancelled'],
  ['error', 'run failed'],
  ['refusal', 'declined the task'],
  ['weird-new-state', 'ended abnormally'],
]) {
  const error = await rejectionOf(() => runWith(failingRun('child-terminal', {
    output: [], stopReason, diagnostic: 'because',
  })))
  check(`终态 ${stopReason} 按失败处理且带上诊断`,
    error !== null && String(error.message).includes(expected)
    && String(error.message).includes('Diagnostic: because'),
    String(error?.message ?? error))
}

// 运行本身被拒绝：原样传播，不要包装成"终态异常"（否则真正的传输错误会被换掉）。
const boom = new Error('transport exploded')
const transportFailure = await rejectionOf(() => runWith(failingRun('child-rejected', boom)))
check('运行被拒绝时原样传播该错误', transportFailure === boom, String(transportFailure))

// 执行与释放都失败：抛 `AggregateError`，两个原因都要在 —— 清理失败不能掩盖执行失败，
// 反过来也不行。
const runFailure = new Error('run failed hard')
const disposeFailure = new Error('dispose failed hard')
const duplicated = await rejectionOf(() => runWith(
  failingRun('child-aggregate', runFailure, disposeFailure),
))
check('执行与释放都失败时抛 AggregateError',
  duplicated instanceof AggregateError && duplicated.errors.length === 2, String(duplicated))
check('AggregateError 的两个原因按「执行、释放」顺序保留',
  duplicated instanceof AggregateError
  && duplicated.errors[0] === runFailure && duplicated.errors[1] === disposeFailure,
  duplicated instanceof AggregateError ? duplicated.errors.map(String).join(' | ') : '(不是 AggregateError)')
check('AggregateError 的说明同时点出两件事',
  duplicated instanceof AggregateError
  && String(duplicated.message).includes('run failed hard')
  && String(duplicated.message).includes('dispose failed hard'))

// 只有释放失败：结果成功也不掩盖清理失败。
const disposeOnly = await rejectionOf(() => runWith(failingRun('child-dispose', {
  output: [{ type: 'text', text: 'done' }], stopReason: 'completed',
}, new Error('dispose only'))))
check('只有释放失败时抛出释放错误',
  disposeOnly !== null && String(disposeOnly.message).includes('dispose only'), String(disposeOnly))

// 取消信号必须原样交给子代理运行，否则上层的取消管不到已启动的子代理。
const signals = []
const controller = new AbortController()
await runForeground(
  {
    list: () => ['only'],
    getProvider: name => ({ name }),
    start: async (_name, request) => {
      signals.push(request.signal)
      return failingRun('child-signal', { output: [], stopReason: 'completed' })
    },
  },
  'only', 'p', 'l', { id: 'agent' }, controller.signal,
)
check('取消信号原样传给子代理运行', signals.length === 1 && signals[0] === controller.signal)

// provider 启动就失败：此时还没拿到 run，没有 dispose 要收尾，错误原样上抛。
const startBoom = new Error('provider refused to start')
const startFailure = await rejectionOf(() => runForeground(
  {
    list: () => ['only'],
    getProvider: providerName => ({ name: providerName }),
    start: async () => { throw startBoom },
  },
  'only', 'p', 'l', { id: 'agent' }, new AbortController().signal,
))
check('启动失败时原样抛出（没有 run 需要释放）', startFailure === startBoom, String(startFailure))

// 工具层 → 子代理的取消链路：上一节只证明 `subagents` 会转发 signal，这里补上
// 「`exec.signal` 真的交到了 `start()` 手上」——上层取消要能管到已启动的子代理。
const toolSignals = []
const toolController = new AbortController()
const signalTool = toolModule.createStructuredPromptTool({
  tools: { register: () => () => {} },
  get: name => (name === 'subagents'
    ? {
      list: () => ['only'],
      getProvider: providerName => ({ name: providerName }),
      start: async (_providerName, request) => {
        toolSignals.push(request.signal)
        return failingRun('child-tool-signal', { output: [], stopReason: 'completed' })
      },
    }
    : undefined),
})
await signalTool.execute(
  { role: 'r', goal: 'g', delegate: {} },
  { signal: toolController.signal, agent: { id: 'agent' } },
)
check('工具层把 exec.signal 交给子代理运行',
  toolSignals.length === 1 && toolSignals[0] === toolController.signal)

// ---- 6f) 装载行配置：默认 provider ----
//
// 部署级选择（用哪个子代理 provider）来自 `cordis.patch.yml` 的 `config`，而不是代码里的
// 常量。校验交给导出的 `Config`（手写的 standard-schema 对象）：形状不对时 cordis 在装载期
// 抛错、`apply` 不会被调用 —— 否则"profile 里写着 fork、实际用 spawn"这种失效没人会发现。
const { Config, narrowConfig } = await import(pathToFileURL(resolve(SRC, 'host', 'config.ts')).href)
const { validate } = Config['~standard']

// 导出的 `Config` 是 cordis 校验装载行配置的入口（只读 `['~standard'].validate`）：手写而
// 不 import 校验库的理由见 `config.ts`。校验失败时 apply 根本不会被调用。
check('Config 是可供 cordis 消费的 standard-schema 对象',
  typeof validate === 'function' && Config['~standard'].version === 1)
check('Config 校验通过时给出收窄后的配置', (() => {
  const result = validate({ provider: '  fork  ' })
  return !('issues' in result) && result.value.provider === 'fork'
})())
check('Config 校验失败时给出 issue 列表', (() => {
  const result = validate({ provider: 42 })
  return 'issues' in result && result.issues.length === 1
    && result.issues[0].message.includes('config.provider')
})())
check('未写 config 时校验通过且得到空配置', (() => {
  const result = validate(undefined)
  return !('issues' in result) && Object.keys(result.value).length === 0
})())

check('未配置时收窄成空对象（等价于用内建默认）',
  Object.keys(narrowConfig(undefined)).length === 0
  && Object.keys(narrowConfig(null)).length === 0)
check('YAML 空值（`provider:` 解析成 null）视同没配',
  narrowConfig({ provider: null }).provider === undefined)
check('provider 被收窄：去空白，空串算没配',
  narrowConfig({ provider: '  fork  ' }).provider === 'fork'
  && narrowConfig({ provider: '   ' }).provider === undefined)
for (const [label, raw] of [
  ['非对象', 'fork'],
  ['数组', ['fork']],
  ['provider 非字符串', { provider: 42 }],
  ['含不支持的字段', { provider: 'spawn', nope: 1 }],
]) {
  const error = await rejectionOf(async () => narrowConfig(raw))
  check(`配置形状不合法时报错（${label}）`, error !== null, String(error?.message ?? error))
}

// 配置是**默认值**：调用参数优先；空串与纯空白算「未给」，因而顶不掉配置。
const configuredProviders = []
const configuredTool = toolModule.createStructuredPromptTool(
  {
    tools: { register: () => () => {} },
    get: name => (name === 'subagents'
      ? {
        list: () => ['fork', 'spawn'],
        getProvider: providerName => ({ name: providerName }),
        start: async (providerName) => {
          configuredProviders.push(providerName)
          return failingRun('child-configured', { output: [], stopReason: 'completed' })
        },
      }
      : undefined),
  },
  { provider: 'fork' },
)
/**
 * 用同一份配置的工具跑一次委托。
 * @param delegate - delegate 参数。
 * @returns 工具的 promise。
 */
const delegateWithConfig = (delegate) => configuredTool.execute(
  { role: 'r', goal: 'g', delegate },
  { signal: new AbortController().signal, agent: { id: 'agent' } },
)
await delegateWithConfig({})
check('配置的 provider 作为默认', configuredProviders.at(-1) === 'fork',
  String(configuredProviders.at(-1)))
await delegateWithConfig({ provider: 'spawn' })
check('调用参数覆盖配置', configuredProviders.at(-1) === 'spawn',
  String(configuredProviders.at(-1)))
await delegateWithConfig({ provider: '   ' })
check('空串/纯空白的 provider 不会顶掉配置', configuredProviders.at(-1) === 'fork',
  String(configuredProviders.at(-1)))
const unknownConfigured = await rejectionOf(() => delegateWithConfig({ provider: 'nope' }))
check('指定未注册的 provider 时报错并列出候选',
  unknownConfigured !== null && String(unknownConfigured.message).includes('fork'),
  String(unknownConfigured?.message ?? unknownConfigured))

// 入口把配置交给注册面；不合法配置要在装载期就失败，而不是静默用默认策略跑起来。
const applyModule = await import(pathToFileURL(resolve(SRC, 'index.ts')).href)
const appliedTools = []
applyModule.apply(
  { tools: { register: tool => { appliedTools.push(tool); return () => {} } } },
  { provider: 'fork' },
)
check('apply 接受装载行配置并注册一个工具',
  appliedTools.length === 1 && appliedTools[0]?.name === toolModule.STRUCTURED_PROMPT_TOOL)
const badApplyConfig = await rejectionOf(async () => applyModule.apply(
  { tools: { register: () => () => {} } }, { provider: 42 },
))
check('apply 在不合法配置上抛错',
  badApplyConfig !== null, String(badApplyConfig?.message ?? badApplyConfig))
// 函数插件混用 default 会让 Loader 丢掉命名空间（`inject` / `Config` 一起丢）—— 这条契约
// 在 `docs/postmortem/0001-acp-default-export-drops-inject.md` 里有真实事故。
check('host 入口只有命名导出，没有 default', applyModule.default === undefined)

// ---- 6g) 模板可以替模型带上身份与目标 ----
//
// 这是「用模板减少要填字段」的前置条件：构建时 role/goal 走 `prefer(调用参数, 模板底座)`，但参数
// 边界原来强制两者非空，模板永远补不进来。实测 10 次真实调用里有 2 次因漏传 role 直接失败，而那
// 两次给出的其余字段都是对的 —— 一次白跑的代价是模型之后不再用它。
/**
 * 调用工具并把失败降级成**空值哨兵**：断言会因取值不符而红，同一节后面的断言仍照常执行。
 * （裸 `await` 会让整套以未捕获异常结束，那样一条 FAIL 都看不到。）
 * @param args - 工具参数。
 * @returns 构建结果；失败时给出带失败原因的空结果。
 */
const tryExecute = async (args) => {
  try {
    return await definition.execute(args, { signal: new AbortController().signal })
  } catch (error) {
    return {
      prompt: '',
      template: '',
      missing: [`<call failed: ${error instanceof Error ? error.message : String(error)}>`],
    }
  }
}

const templateOnly = await tryExecute({ goal: '只检查依赖变更。', template: 'code-review' })
check('只给 goal + template 时不再因缺 role 被边界拒绝',
  templateOnly.missing.length === 0, templateOnly.missing.join(','))
check('身份由模板提供',
  templateOnly.prompt.startsWith('# 身份\n') && templateOnly.prompt.includes('严格的高级工程师'),
  templateOnly.prompt.slice(0, 90))
check('模板回传的 id 仍是所选模板', templateOnly.template === 'code-review')

const bothFromTemplate = await tryExecute({ template: 'code-review' })
check('连 goal 也省掉时同样由模板补齐',
  bothFromTemplate.missing.length === 0 && bothFromTemplate.prompt.includes('# 目标\n'),
  bothFromTemplate.prompt.slice(0, 90))

const overriddenRole = await tryExecute({
  role: '一名临时审计员', goal: '只检查依赖变更。', template: 'code-review',
})
check('给了 role 就用调用参数的（模板只是默认值）',
  overriddenRole.prompt.includes('一名临时审计员')
  && !overriddenRole.prompt.includes('严格的高级工程师'))
const blankRole = await tryExecute({ role: '   ', goal: 'x', template: 'code-review' })
check('空白身份回退到模板（空串算「未给」）', blankRole.prompt.includes('严格的高级工程师'))

const noTemplate = await rejectionOf(() => definition.execute({ goal: 'x' }))
check('不带模板时缺 role 仍报错，且错误信息给出出路',
  noTemplate !== null && /role/.test(String(noTemplate.message))
  && String(noTemplate.message).includes('template'),
  String(noTemplate?.message ?? noTemplate))
check('放宽的是「缺失/空白」而不是类型：有模板时 role 传数字照样报错',
  (await rejectionOf(() => definition.execute({ role: 42, goal: 'x', template: 'code-review' }))) !== null)

// 下面两条钉的是**措辞**（口径一致性），不是可替换的同义词：改文案就要同步改断言 —— 与 `delegate`
// 描述那条同源。示例那条用形式断言：换示例模板不该报错，删掉示例必须报错。
check('工具说明与参数说明同口径：都写明模板会带上 role 与 goal',
  String(definition.description).includes('carries both')
  && String(properties.template.description ?? '').includes('including `role` and `goal`'),
  String(definition.description).slice(0, 130))
check('工具说明给出一个「模板 + 具体目标」的例子',
  /For example: `\{ template: '[a-z-]+', goal: '[^']*' \}`/.test(String(definition.description)),
  String(definition.description).slice(120, 320))
check('goal 的描述提示「能写具体就写具体」',
  String(properties.goal.description ?? '').includes('concrete task'))

// 未知模板 id 必须报错：静默降级成空白底座会产出一份短得多的提示词而无人察觉。
check('未知 template 被拒（拼错时不再静默降级）',
  (await rejectionOf(() => run({ goal: 'g', template: 'code-reviw' }))) !== null)
check('合法 template 被接受', (await run({ goal: 'g', template: 'code-review' })).template === 'code-review')

// 空串算「未给」，与 prefer 的约定一致（模型用它表达"不指定格式"时不该失败）。
check('output_format 空串被当作未给',
  (await run({ goal: 'g', output_format: '' })).prompt.includes('g'))
check('tool_policy 空串被当作未给',
  (await run({ goal: 'g', tool_policy: '' })).prompt.includes('g'))

// host 侧不再维护第二份格式骨架逻辑（否则它会与客户端的 applyFormatChoice 各自演化
// —— 上一轮的格式分叉就是同类根因）。
//
// 只断言"某个函数名不存在"太弱：换个名字写回来照样通过。所以再加一条**行为**断言：
// 同一组状态经 host 与经客户端路径必须产出逐字相同。
check('host 侧不再有独立的格式骨架实现', argsModule.resolveOutputSpec === undefined)

const { applyFormatChoice } = await import(pathToFileURL(resolve(SRC, 'shared', 'format.ts')).href)
const reportTemplate = TEMPLATES.find(item => item.id === 'report')
const hostVsClient = (() => {
  const fromHost = buildFromArgs(argsModule.narrowArgs({
    role: 'r', goal: 'g', template: 'report', output_format: 'json',
  })).prompt
  const base = reportTemplate.build()
  const fromClient = prompt.buildSystemPrompt(completeForm({
    ...base,
    role: 'r',
    goal: 'g',
    outputFormat: 'json',
    // 客户端点选格式时走 applyFormatChoice 更新说明。
    outputSpec: applyFormatChoice(base.outputSpec, 'json'),
  }))
  return { fromHost, fromClient }
})()
check('模板 + 指定另一套格式时两个入口逐字相同',
  hostVsClient.fromHost === hostVsClient.fromClient,
  hostVsClient.fromHost === hostVsClient.fromClient
    ? ''
    : `\n--- host ---\n${hostVsClient.fromHost}\n--- client ---\n${hostVsClient.fromClient}`)

// delegate 的子字段也走参数校验
check('delegate 的未知子字段被拒', (await rejectionOf(() => withService.execute(
  { role: 'r', goal: 'g', delegate: { nope: 1 } },
  { signal: new AbortController().signal, agent: { id: 'agent' } },
))) !== null)
check('delegate 非对象被拒', (await rejectionOf(() => withService.execute(
  { role: 'r', goal: 'g', delegate: 'yes' },
  { signal: new AbortController().signal, agent: { id: 'agent' } },
))) !== null)

// ---- 7) 注册面 ----

const registered = []
const disposer = toolModule.registerStructuredPromptTool({
  tools: { register: (tool) => { registered.push(tool); return () => {} } },
})
check('registerStructuredPromptTool 注册了一个工具', registered.length === 1)
check('注册的正是本工具', registered[0]?.name === toolModule.STRUCTURED_PROMPT_TOOL)
check('返回取消注册函数', typeof disposer === 'function')

// ---- 8) 提示词库：上游映射、路由与配置 ----
//
// 被测对象是 **host 半边的检索路由**。它必须由宿主代发（上游 prompts.chat 不返回 CORS 头，
// 浏览器直连会被拒），所以断言分三层：纯映射与参数夹取、路由 handler 的上游 URL 与失败归一、
// 以及注册面（有 `connection` 才注册、没有就跳过 —— 与 `delegate` 走 `ctx.get` 是同一条规则）。

const libraryModule = await import(pathToFileURL(resolve(SRC, 'host', 'library.ts')).href)
const lib = await import(pathToFileURL(resolve(SRC, 'shared', 'library.ts')).href)

check('条数被夹进上游可接受的范围',
  lib.clampLimit(undefined) === lib.LIBRARY_DEFAULT_LIMIT
  && lib.clampLimit(0) === 1 && lib.clampLimit(-3) === 1
  && lib.clampLimit(9999) === lib.LIBRARY_MAX_LIMIT
  && lib.clampLimit(Number.NaN) === lib.LIBRARY_DEFAULT_LIMIT,
  [undefined, 0, -3, 9999, Number.NaN].map(v => `${String(v)}→${lib.clampLimit(v)}`).join(' '))

check('查询词折叠空白并截断',
  lib.normalizeQuery('  code   review  ') === 'code review'
  && lib.normalizeQuery('   ') === ''
  && lib.normalizeQuery('x'.repeat(200)).length === lib.LIBRARY_MAX_QUERY_LENGTH)

// id 会被拼进上游 URL 的**路径**，这是路径注入的口子，必须在边界上挡死。
check('非法 id 被拒（含路径注入）',
  lib.isValidItemId('cmv8u3ofi0007kx06jghws9ya')
  && !lib.isValidItemId('../secret')
  && !lib.isValidItemId('a/b')
  && !lib.isValidItemId('a?x=1')
  && !lib.isValidItemId('')
  && !lib.isValidItemId('x'.repeat(65)))

check('上游记录映射成稳定形状', (() => {
  const item = lib.mapItem({ id: 'abc', title: 'T', description: 'D', author: { username: 'u' } })
  return item !== undefined && item.id === 'abc' && item.title === 'T'
    && item.description === 'D' && item.author === 'u'
})(), JSON.stringify(lib.mapItem({ id: 'abc', title: 'T' })))

check('字段缺失时给空串而不是 undefined', (() => {
  const item = lib.mapItem({ id: 'abc' })
  return item !== undefined && item.title === '' && item.description === '' && item.author === ''
})())

check('列表映射逐条过滤坏记录（一条坏的不该毁掉整次检索）', (() => {
  const result = lib.mapSearchResponse({
    prompts: [{ id: 'ok', title: 'T' }, null, 7, { id: '../x' }, { title: 'no id' }],
    total: 12,
  })
  return result.items.length === 1 && result.items[0].id === 'ok' && result.total === 12
})(), JSON.stringify(lib.mapSearchResponse({ prompts: [null] })))

check('详情缺 content 时不算详情',
  lib.mapDetail({ id: 'abc', title: 'T' }) === undefined
  && lib.mapDetail({ id: 'abc', content: '正文' })?.content === '正文')

// 路由 handler：上游 URL、失败归一，以及"不转发浏览器请求头"。
const upstreamCalls = []
/**
 * 造一个记录调用的假上游。
 * @param body - 上游响应体。
 * @param status - 上游状态码。
 * @param failure - 传了 Error 表示请求本身失败。
 * @returns 请求实现。
 */
const makeUpstream = (body, status = 200, failure) => (url, options) => {
  upstreamCalls.push({ url: String(url), options })
  if (failure !== undefined) return Promise.reject(failure)
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}
/**
 * 造一条检索路由的请求。
 *
 * 刻意用**鸭子类型的假请求**（而不是 `new Request`）：`new Request` 会按 fetch 规范丢掉部分
 * forbidden header（例如 `cookie`），用它就证明不了「不转发入站头」—— 而那条断言要证明的恰恰
 * 是"实现读不读入站头"。假请求带真实的 `Headers`，因此能如实携带敏感头。
 * @param query - 查询串（含 `?`）。
 * @param headers - 入站头（模拟浏览器带来的）。
 * @param method - HTTP 方法。
 * @returns 请求对象。
 */
const searchRequest = (query, headers, method = 'GET') => ({
  method,
  url: `http://127.0.0.1:19387/api/structured-prompt/library${query}`,
  signal: new AbortController().signal,
  headers: new Headers(headers ?? {}),
})

/**
 * 造一条取全文路由的请求（同上，鸭子类型）。
 * @param id - 查询的 id（需要编码的部分由调用方写好）。
 * @returns 请求对象。
 */
const libraryItemRequest = id => ({
  method: 'GET',
  url: `http://127.0.0.1:19387/api/structured-prompt/library/item?id=${id}`,
  signal: new AbortController().signal,
  headers: new Headers(),
})

const hit = await libraryModule.handleLibrarySearch(
  searchRequest('?q=code+review&limit=5'), undefined,
  makeUpstream({ prompts: [{ id: 'a1', title: 'T' }], total: 3 }),
)
check('检索路由把查询词交给上游的 title 检索端点',
  upstreamCalls.at(-1).url === 'https://prompts.chat/api/prompts/search?q=code+review&limit=5',
  String(upstreamCalls.at(-1).url))
check('检索路由回映射后的结果', JSON.parse(await hit.text()).items[0].id === 'a1')

await libraryModule.handleLibrarySearch(searchRequest(''), undefined, makeUpstream({ prompts: [] }))
check('空查询走列表端点（打开就有东西可看）',
  upstreamCalls.at(-1).url === `https://prompts.chat/api/prompts?perPage=${lib.LIBRARY_DEFAULT_LIMIT}`,
  String(upstreamCalls.at(-1).url))

// 不跟随重定向：跟随就等于绕开配置里的地址（302 能把请求带去任意主机）。
check('上游请求不跟随重定向（302 不能把请求带去别处）',
  upstreamCalls.at(-1).options.redirect === 'error',
  String(upstreamCalls.at(-1).options.redirect))

// 上游回非 JSON：归一成 502 与可读说明，而不是让 `response.json()` 的异常冒出去。
const notJsonResponse = await libraryModule.handleLibrarySearch(
  searchRequest('?q=x'),
  undefined,
  (url, options) => {
    upstreamCalls.push({ url: String(url), options })
    return Promise.resolve(new Response('<html>not json</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))
  },
)
const notJsonBody = await notJsonResponse.text()
check('上游回非 JSON 时给 502 与可读说明',
  notJsonResponse.status === 502 && notJsonBody.includes('不是 JSON'),
  `${notJsonResponse.status} ${notJsonBody}`)

// 浏览器已经取消：给出"已取消"而不是把它当成"上游挂了"。
const cancelledController = new AbortController()
cancelledController.abort()
const cancelledRequest = {
  method: 'GET',
  url: 'http://127.0.0.1:19387/api/structured-prompt/library?q=x',
  signal: cancelledController.signal,
  headers: new Headers(),
}
const abortError = new Error('aborted')
abortError.name = 'AbortError'
const cancelledResponse = await libraryModule.handleLibrarySearch(
  cancelledRequest,
  undefined,
  (url, options) => {
    upstreamCalls.push({ url: String(url), options })
    return Promise.reject(abortError)
  },
)
const cancelledBody = await cancelledResponse.text()
check('浏览器已取消时给出取消说明（不冒充上游故障）',
  cancelledResponse.status === 499 && cancelledBody.includes('已取消'),
  `${cancelledResponse.status} ${cancelledBody}`)

const upstreamError = await libraryModule.handleLibrarySearch(
  searchRequest('?q=x'), undefined, makeUpstream({}, 500),
)
// `Response.body` 只能读一次：先取文本，让断言与 detail 共用同一个字符串，
// 否则第二次 `text()` 抛 "Body is unusable"（本批踩到过）。
const upstreamErrorBody = await upstreamError.text()
check('上游非 2xx 归一成 502 与可读说明',
  upstreamError.status === 502 && upstreamErrorBody.includes('500'),
  `${upstreamError.status} ${upstreamErrorBody}`)

const networkError = await libraryModule.handleLibrarySearch(
  searchRequest('?q=x'), undefined, makeUpstream({}, 200, new Error('socket hang up')),
)
const networkErrorBody = await networkError.text()
check('网络失败归一成 502（不作为异常抛给浏览器）',
  networkError.status === 502 && networkErrorBody.includes('无法连接上游'),
  `${networkError.status} ${networkErrorBody}`)

const timeoutError = new Error('timed out')
timeoutError.name = 'TimeoutError'
const timedOut = await libraryModule.handleLibrarySearch(
  searchRequest('?q=x'), undefined, makeUpstream({}, 200, timeoutError),
)
const timedOutBody = await timedOut.text()
check('超时归一成 504',
  timedOut.status === 504 && timedOutBody.includes('毫秒内没有响应'),
  `${timedOut.status} ${timedOutBody}`)

// 入站头要真的带上才谈得上"不转发"：`new Request` 会丢掉 `cookie` 这类 forbidden header，
// 所以这里用鸭子类型的假请求（带真实 `Headers`），并断言上游**只**收到 `accept`。
const sensitiveHeaders = {
  cookie: 'dsh_browser=secret',
  authorization: 'Bearer secret',
  origin: 'http://127.0.0.1:19387',
  'x-forwarded-for': '10.0.0.1',
  'user-agent': 'browser',
}
await libraryModule.handleLibrarySearch(
  searchRequest('?q=x', sensitiveHeaders), undefined, makeUpstream({ prompts: [] }),
)
check('不向上游转发浏览器请求头（含 cookie）', (() => {
  const options = upstreamCalls.at(-1).options
  return options.method === 'GET' && Object.keys(options.headers).join() === 'accept'
})(), JSON.stringify(upstreamCalls.at(-1).options.headers))

const beforeIllegal = upstreamCalls.length
const illegal = await libraryModule.handleLibraryItem(
  new Request('http://127.0.0.1:19387/api/structured-prompt/library/item?id=..%2Fetc'), undefined, makeUpstream({}),
)
check('非法 id 在边界被拒且不触碰上游',
  illegal.status === 400 && upstreamCalls.length === beforeIllegal,
  `${illegal.status}；期间的上游调用数 ${upstreamCalls.length - beforeIllegal}`)

const detailHit = await libraryModule.handleLibraryItem(
  libraryItemRequest('a1'),
  undefined,
  makeUpstream({ id: 'a1', title: 'T', content: 'BODY' }),
)
check('详情路由取到全文', JSON.parse(await detailHit.text()).item.content === 'BODY')

// 真实路径：上游对不存在的 id 返回 **404**（实测），我们透传成 404 —— "记录没了"与
// "上游挂了"在界面上是两句话。
const upstreamMissing = await libraryModule.handleLibraryItem(
  libraryItemRequest('a1'),
  undefined,
  makeUpstream({}, 404),
)
const upstreamMissingBody = await upstreamMissing.text()
check('上游 404 时我们回 404（区分记录不存在与上游故障）',
  upstreamMissing.status === 404 && upstreamMissingBody.includes('上游没有这条提示词'),
  `${upstreamMissing.status} ${upstreamMissingBody}`)

// 防御支：上游 2xx 但记录里没有正文 —— 那是"上游给的东西不合预期"，不是"没有这条记录"。
const shapeBroken = await libraryModule.handleLibraryItem(
  libraryItemRequest('a1'),
  undefined,
  makeUpstream({ id: 'a1' }),
)
const shapeBrokenBody = await shapeBroken.text()
check('上游 2xx 但缺正文时给 502（与记录不存在区分开）',
  shapeBroken.status === 502, `${shapeBroken.status} ${shapeBrokenBody}`)

const wrongMethod = await libraryModule.handleLibrarySearch(
  new Request('http://127.0.0.1:19387/api/structured-prompt/library', { method: 'POST' }), undefined, makeUpstream({}),
)
check('非 GET 被拒（405 且带 allow）',
  wrongMethod.status === 405 && wrongMethod.headers.get('allow') === 'GET', String(wrongMethod.status))

check('未配置 libraryBaseUrl 时用默认上游',
  libraryModule.libraryBaseUrl(undefined) === lib.DEFAULT_LIBRARY_BASE_URL
  && libraryModule.libraryBaseUrl({}) === lib.DEFAULT_LIBRARY_BASE_URL)

await libraryModule.handleLibrarySearch(
  searchRequest('?q=x'), { libraryBaseUrl: 'https://self.example' }, makeUpstream({ prompts: [] }),
)
check('配置了 libraryBaseUrl 时指向自托管实例',
  upstreamCalls.at(-1).url.startsWith('https://self.example/api/prompts/search'),
  String(upstreamCalls.at(-1).url))

// 安全边界：基础地址**只来自配置**。请求参数若能改写它，这条路由就成了任意 URL 代理
// （浏览器侧的任何脚本都能借宿主的网络身份去打内网）。
await libraryModule.handleLibrarySearch(
  new Request('http://127.0.0.1:19387/api/structured-prompt/library'
    + '?q=x&base=https://evil.example&url=https://evil.example&host=https://evil.example'),
  { libraryBaseUrl: 'https://self.example' },
  makeUpstream({ prompts: [] }),
)
check('请求参数不能改写上游基础地址（这条路由不是任意 URL 代理）',
  upstreamCalls.at(-1).url.startsWith('https://self.example/'),
  String(upstreamCalls.at(-1).url))

// 自托管把实例挂在子路径下时，必须保留子路径 —— 这正是把绝对路径改成相对拼接的原因。
await libraryModule.handleLibrarySearch(
  searchRequest('?q=x'), { libraryBaseUrl: 'https://host/sub' }, makeUpstream({ prompts: [] }),
)
check('基础地址带子路径时保留它（相对拼接，不是绝对路径）',
  upstreamCalls.at(-1).url.startsWith('https://host/sub/api/prompts/search'),
  String(upstreamCalls.at(-1).url))

// 检索端点没有"记录不存在"这种语义：那里的 404 只说明上游没有这个端点（自托管版本或子路径
// 配错），说成"没有这条提示词"会把人带偏 —— 404 特判只属于取全文那条路。
const search404 = await libraryModule.handleLibrarySearch(
  searchRequest('?q=x'), undefined, makeUpstream({}, 404),
)
const search404Body = await search404.text()
check('检索端点的 404 不冒充"记录不存在"',
  search404.status === 502 && !search404Body.includes('这条提示词'),
  `${search404.status} ${search404Body}`)

check('Config 拒绝会被改写 origin 的地址与带 query/hash 的写法', (() => {
  const credentials = validate({ libraryBaseUrl: 'https://host@evil.example' })
  const withQuery = validate({ libraryBaseUrl: 'https://host/sub?x=1' })
  const withHash = validate({ libraryBaseUrl: 'https://host/sub#frag' })
  return 'issues' in credentials && 'issues' in withQuery && 'issues' in withHash
})())

// 两侧各写一份路径字面量，靠这条交叉断言防止"改一边忘另一边"。
const clientLibrary = await import(pathToFileURL(resolve(SRC, 'client', 'library.ts')).href)
check('客户端与宿主的路由路径常量一致',
  clientLibrary.LIBRARY_SEARCH_PATH === libraryModule.LIBRARY_ROUTE_PATH
  && clientLibrary.LIBRARY_ITEM_PATH === libraryModule.LIBRARY_ITEM_ROUTE_PATH,
  `${clientLibrary.LIBRARY_SEARCH_PATH} vs ${libraryModule.LIBRARY_ROUTE_PATH}`)

check('Config 校验 libraryBaseUrl 的形状', (() => {
  const notString = validate({ libraryBaseUrl: 42 })
  const noHost = validate({ libraryBaseUrl: 'https://' })
  const wrongScheme = validate({ libraryBaseUrl: 'ftp://x.example' })
  return 'issues' in notString && notString.issues[0].message.includes('libraryBaseUrl')
    && 'issues' in noHost && 'issues' in wrongScheme
})())

check('Config 收窄 libraryBaseUrl：去空白去尾斜杠，空串算没配', (() => {
  const ok = validate({ libraryBaseUrl: '  https://self.example/  ' })
  return !('issues' in ok) && ok.value.libraryBaseUrl === 'https://self.example'
    && Object.keys(narrowConfig({ libraryBaseUrl: '   ' })).length === 0
})(), JSON.stringify(validate({ libraryBaseUrl: '  https://self.example/  ' })))

// 注册面：**必须走 `ctx.inject`** —— 加载器的 entry 是并行创建的，在 apply 期读一次
// `ctx.get('connection')` 很可能读到"还没就绪"，然后永久跳过注册且毫无报错（浏览器那边只
// 看到共享通道的 404）。这条断言锁的是"等就绪"，不是"读得到"。
const routeRegistrations = []
const injectedDeps = []
/**
 * 造一个假 host 上下文。
 * @param connection - `ctx.get('connection')` 的返回值；`undefined` 模拟没有 web 载体。
 * @param options - 关掉某个能力面，用来覆盖降级路径。
 * @returns 假上下文。
 */
const hostCtx = (connection, options = {}) => {
  const self = {
    ...(options.noInject === true ? {} : {
      inject: (deps, callback) => {
        injectedDeps.push([...deps])
        // 真实现的回调收到的是**子作用域**上下文（副作用挂在它上面才会随服务释放），
        // 假上下文里就把自己传进去。
        callback(self)
        return deps
      },
    }),
    ...(options.noEffect === true ? {} : { effect: (factory, label) => { factory(); return label } }),
    get: name => (name === 'connection' ? connection : undefined),
  }
  return self
}
const connectionFace = {
  fetch: {
    register: (route) => {
      routeRegistrations.push(route)
      return async () => {}
    },
  },
}
libraryModule.registerLibraryRoute(hostCtx(connectionFace), undefined)
check('注册等 connection 就绪（经 ctx.inject，不是 apply 期读一次）',
  injectedDeps.length === 1 && injectedDeps[0].join() === 'connection',
  JSON.stringify(injectedDeps))
check('有 connection 时注册两条只读路由',
  routeRegistrations.length === 2
  && routeRegistrations.every(route => route.methods.join() === 'GET' && route.requestBody === 'buffered')
  && routeRegistrations.map(route => route.path).join()
    === [libraryModule.LIBRARY_ROUTE_PATH, libraryModule.LIBRARY_ITEM_ROUTE_PATH].join(),
  routeRegistrations.map(route => `${route.path} ${route.methods} ${route.requestBody}`).join(' | '))
check('两条路由都挂在 /api 之下（connection 的精确路由要求）',
  routeRegistrations.every(route => route.path.startsWith('/api/')))

const beforeDegrade = routeRegistrations.length
libraryModule.registerLibraryRoute(hostCtx(undefined), undefined)
libraryModule.registerLibraryRoute(hostCtx(connectionFace, { noInject: true }), undefined)
libraryModule.registerLibraryRoute(hostCtx(connectionFace, { noEffect: true }), undefined)
check('没有 connection / 没有 inject 面 / 没有 effect 面时都不注册（工具不受影响）',
  routeRegistrations.length === beforeDegrade, String(routeRegistrations.length))

const applyRoutes = []
const applyConnection = {
  fetch: {
    register: (route) => {
      applyRoutes.push(route)
      return async () => {}
    },
  },
}
applyModule.apply(
  {
    ...hostCtx(applyConnection),
    tools: { register: tool => { appliedTools.push(tool); return () => {} } },
  },
  { provider: 'fork' },
)
check('apply 在 connection 就绪时一并注册检索路由（经 ctx.inject）',
  applyRoutes.length === 2, String(applyRoutes.length))

if (failed > 0) {
  console.error(`\n${failed} 项工具测试未通过。`)
  process.exit(1)
}
console.log('\n全部工具测试通过。')
