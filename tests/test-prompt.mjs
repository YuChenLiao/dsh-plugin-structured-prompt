/**
 * 提示词构建的行为自测（不需要 DSH 运行时）。
 *
 * `prompt.ts` 是纯模块，可以直接导入比对。这里的第一个断言最重要：它把生成结果
 * 与本插件最初那份示例的期望输出**逐字**对比，防止重构改动提示词格式。
 *
 * 用法：node tests/test-prompt.mjs
 */
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHARED = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'shared')
const prompt = await import(pathToFileURL(resolve(SHARED, 'prompt.ts')).href)
const {
  buildSystemPrompt, validateForm, OUTPUT_FORMAT_SKELETONS,
} = prompt
const { applyFormatChoice, formatSpecStatus } = await import(
  pathToFileURL(resolve(SHARED, 'format.ts')).href
)
const { TEMPLATES, ALERT_TRIAGE_FIELDS } = await import(
  pathToFileURL(resolve(SHARED, 'templates.ts')).href
)
const { createEmptyForm } = await import(pathToFileURL(resolve(SHARED, 'forms.ts')).href)

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : `\n      ${detail}`}`)
  if (!ok) failed += 1
}

/** 以空白表单为底、叠加片段，得到完整表单。 */
const form = patch => ({ ...createEmptyForm(), ...patch })

// 1) 复现原始实现的期望输出：字段顺序与格式必须逐字一致。
const expected = [
  '# 身份\n你是一名负责线上稳定性的 SRE 助手，服务于一个日订单量百万级的电商系统。',
  '# 目标\n根据监控数据判断告警是否需要人工立即介入，并给出首要排查方向。',
  '# 硬性规则（必须遵守，优先于其他任何要求）\n'
    + '1. 只能基于工具返回的数据下结论，不得引用记忆中其他系统的经验值。\n'
    + '2. 所有数值必须带上单位和时间窗口，例如 940ms / 近 5 分钟。\n'
    + '3. 阈值判断必须以指标配置为准；配置缺失时明确说明缺失，不要用默认值代替。',
  '# 输出格式\n以 JSON 输出，字段如下：\n- severity: "P0" | "P1" | "P2" | "info"',
  '# 数据不足时\n若关键指标或阈值任一缺失，severity 返回 "info"，并在 data_gaps 中列出缺失项。禁止编造数值。',
  '# 示例\n输入 A → 输出 B',
].join('\n\n')

const actual = buildSystemPrompt(form({
  role: '你是一名负责线上稳定性的 SRE 助手，服务于一个日订单量百万级的电商系统。',
  goal: '根据监控数据判断告警是否需要人工立即介入，并给出首要排查方向。',
  rules: [
    '只能基于工具返回的数据下结论，不得引用记忆中其他系统的经验值。',
    '所有数值必须带上单位和时间窗口，例如 940ms / 近 5 分钟。',
    '阈值判断必须以指标配置为准；配置缺失时明确说明缺失，不要用默认值代替。',
  ],
  outputSpec: '以 JSON 输出，字段如下：\n- severity: "P0" | "P1" | "P2" | "info"',
  fallback: '若关键指标或阈值任一缺失，severity 返回 "info"，并在 data_gaps 中列出缺失项。禁止编造数值。',
  examples: '输入 A → 输出 B',
}))

check('段落顺序与原始实现一致', actual === expected, actual === expected ? '' : `实际：\n${actual}`)
check('空段落被省略（无「工具使用策略」标题）', !actual.includes('# 工具使用策略'))

// 2) 纯空白字段也算「未填写」。
const blank = buildSystemPrompt(form({ role: '   ', goal: '\n\n', toolPolicy: 'auto' }))
check('身份与目标只有空白时，仍不生成身份/目标段', !blank.includes('# 身份') && !blank.includes('# 目标'))
check('工具策略为自动时生成策略引导语', blank.includes('自行判断'))

// 3) 必填校验。
check('身份与目标缺失时报出两项', validateForm(form({ role: ' ', goal: '' })).join(',') === '身份,目标')
check('填写完整时无缺失项', validateForm(form({ role: 'a', goal: 'b' })).length === 0)

// 4) 工具策略：手动模式下用户点名的工具进入提示词。
const manual = buildSystemPrompt(form({
  role: 'r',
  goal: 'g',
  toolPolicy: 'manual',
  callableTools: ['query_metrics', 'get_threshold_config', 'list_metric_windows'],
  // 用途按索引配对；第二条留空，应当只写工具名。
  toolSlots: ['拉取指标', '', '确认可用时间窗口'],
  toolGuidance: ['先读文件再下结论'],
  toolFailure: '失败就报告失败',
}))
check('手动模式限定只允许调用点名的工具',
  manual.includes('只允许调用下列已指定的工具，其余工具一律不要使用：'))
check('手动模式逐行列出工具名', manual.includes('- query_metrics：拉取指标')
  && manual.includes('- list_metric_windows：确认可用时间窗口'))
check('用途留空时只写工具名',
  (manual.split('\n').find(line => line.includes('get_threshold_config')) ?? '').trim() === '- get_threshold_config')
check('工具使用策略段含逐条策略与失败处理',
  manual.includes('- 先读文件再下结论') && manual.includes('工具失败时：失败就报告失败'))
check('手动模式不出现「自行判断」', !manual.includes('自行判断'))
// 没有点名任何工具时，手动策略不应产生空转的策略行。
const manualNoTools = buildSystemPrompt(form({ role: 'r', goal: 'g', toolPolicy: 'manual' }))
check('手动模式未点名工具时不产生策略行', !manualNoTools.includes('只允许调用下列已指定的工具'))
// 只有用途、没有工具名的行整体忽略。
const orphanSlot = buildSystemPrompt(form({
  role: 'r', goal: 'g', toolPolicy: 'manual', callableTools: [''], toolSlots: ['只有用途'],
}))
check('工具名留空的行整体忽略', !orphanSlot.includes('只有用途'))

// 5) 扩写字段落在既有段落内，没有新增顶层段落。
const extended = buildSystemPrompt(form({
  role: '身份文本',
  goal: '目标文本',
  background: '背景文本',
  successCriteria: '完成判据',
  rules: ['规则一'],
  forbidden: ['禁止一'],
  toolPolicy: 'auto',
  outputFormat: 'json',
  languageTone: '中文简洁',
  fields: ['a: string'],
  fallback: '兜底',
  examples: '示例',
}))
const headings = [...extended.matchAll(/^# .+$/gm)].map(match => match[0])
check('顶层段落仍只有原始那 7 个标题',
  headings.join('|') === [
    '# 身份', '# 目标', '# 硬性规则（必须遵守，优先于其他任何要求）',
    '# 工具使用策略', '# 输出格式', '# 数据不足时', '# 示例',
  ].join('|'),
  headings.join(' | '))
check('背景并入身份段', extended.includes('# 身份\n身份文本\n背景文本'))
check('成功标准并入目标段', extended.includes('# 目标\n目标文本\n完成标准：完成判据'))
check('禁止行为并入硬性规则段', extended.includes('禁止行为（同样不可违反）：\n- 禁止一'))
check('字段级说明并入输出格式段', extended.includes('字段说明：\n- a: string'))
check('表达要求并入输出格式段', extended.includes('表达要求：中文简洁'))
check('JSON 骨架被填入输出格式段', extended.includes(OUTPUT_FORMAT_SKELETONS.json))

// 5b) 回归防线：格式类型与格式说明**同时**给出时，骨架只出现一次。
//
// 客户端的 pickFormat 会把骨架写进 outputSpec，早先的实现又在 outputBody 里按
// outputFormat 拼了一遍，于是"选了格式"的表单产出两遍骨架（工具侧 output_format
// 走同一路径，同样重复）。
const bothGiven = buildSystemPrompt(form({ outputFormat: 'json', outputSpec: OUTPUT_FORMAT_SKELETONS.json }))
const skeletonOccurrences = bothGiven.split(OUTPUT_FORMAT_SKELETONS.json).length - 1
check('格式与说明同时给出时骨架不重复', skeletonOccurrences === 1, `出现 ${skeletonOccurrences} 次`)

// 自定义说明优先于格式骨架，且位置在「输出格式」段开头。
const customSpec = buildSystemPrompt(form({ outputFormat: 'json', outputSpec: '以 TOML 输出' }))
check('自定义说明优先于格式骨架', customSpec.includes('以 TOML 输出') && !customSpec.includes('以 JSON 输出'))
check('自定义说明紧随「输出格式」标题',
  customSpec.includes('# 输出格式\n以 TOML 输出'))

// 5c) 格式类型切换：说明里的骨架部分要被替换，追加过的内容要保留。
//
// 早先的规则是「说明已被手写就完全不覆盖」，于是用户改选格式类型后，产物里仍是旧格式
// 的契约、而 UI 上已是新值 —— 两边静默分叉（子代理审查发现的回归）。
const jsonWithExtra = `${OUTPUT_FORMAT_SKELETONS.json}\n- severity: "P0"`
const switched = applyFormatChoice(jsonWithExtra, 'markdown')
check('切换格式时只替换骨架部分、保留追加内容',
  switched === `${OUTPUT_FORMAT_SKELETONS.markdown}\n- severity: "P0"`, switched)
check('切换格式后产物与所选格式自洽',
  buildSystemPrompt(form({ outputFormat: 'markdown', outputSpec: switched }))
    .includes(OUTPUT_FORMAT_SKELETONS.markdown))
check('说明为空时整段填入骨架',
  applyFormatChoice('', 'table') === OUTPUT_FORMAT_SKELETONS.table)
check('说明仍是某套骨架时整段替换',
  applyFormatChoice(OUTPUT_FORMAT_SKELETONS.json, 'text') === OUTPUT_FORMAT_SKELETONS.text)
check('完全手写的说明不被覆盖',
  applyFormatChoice('以 TOML 输出', 'json') === '以 TOML 输出')
check('清除格式选择时说明保持不变',
  applyFormatChoice(OUTPUT_FORMAT_SKELETONS.json, '') === OUTPUT_FORMAT_SKELETONS.json)

// 说明带首尾空白时也要能识别出"仍是某套骨架"：用未 trim 的值比较会让替换不命中，
// 说明留在旧格式上，而 formatSpecStatus 又按 trim 判定成 detached —— 界面把
// "替换逻辑没命中"误报成"用户手写了契约"。
check('说明带首尾空白时仍能替换骨架',
  applyFormatChoice(`  ${OUTPUT_FORMAT_SKELETONS.json}  `, 'markdown') === OUTPUT_FORMAT_SKELETONS.markdown)
check('说明 = 带空白的骨架 + 追加时保留追加',
  applyFormatChoice(`  ${OUTPUT_FORMAT_SKELETONS.json}\n- extra`, 'markdown')
    === `${OUTPUT_FORMAT_SKELETONS.markdown}\n- extra`)

// 5d) 越界的格式类型不得让输出格式段静默少内容（骨架取不到时不应拼出空块）。
check('越界格式类型不产生空的输出格式段',
  !buildSystemPrompt(form({ outputFormat: 'csv', outputSpec: '' })).includes('# 输出格式'))

// 5e) 说明与格式类型的关系判定 —— 界面据此说出"格式类型已被说明覆盖"。
check('说明为空 → empty', formatSpecStatus('', 'json') === 'empty')
check('说明就是骨架 → matches',
  formatSpecStatus(OUTPUT_FORMAT_SKELETONS.json, 'json') === 'matches')
check('说明 = 骨架 + 追加 → extends',
  formatSpecStatus(`${OUTPUT_FORMAT_SKELETONS.json}\n- severity: "P0"`, 'json') === 'extends')
check('说明与所选格式无关 → detached',
  formatSpecStatus('以 TOML 输出', 'json') === 'detached')
check('说明是「另一套」骨架 → detached（改选格式后就落到这里）',
  formatSpecStatus(OUTPUT_FORMAT_SKELETONS.json, 'markdown') === 'detached')
check('没选格式时说明自成一格（不算遮蔽）',
  formatSpecStatus('以 TOML 输出', '') === 'detached'
  && formatSpecStatus(OUTPUT_FORMAT_SKELETONS.json, '') === 'detached')

// 6) 原始示例模板必须能复现「告警研判」示例的全部内容。
const fromTemplate = buildSystemPrompt(form(ALERT_TRIAGE_FIELDS))
check('告警研判模板含阈值约束与 3 条编号规则',
  fromTemplate.includes('3. 阈值判断必须以指标配置为准') && !fromTemplate.includes('4. '))
check('告警研判模板的策略为自动（未点名工具时不空转）',
  fromTemplate.includes('自行判断') && !fromTemplate.includes('只允许调用下列已指定的工具'))
check('告警研判模板的禁止行为以子块出现', fromTemplate.includes('禁止行为（同样不可违反）：'))
check('告警研判模板含工具失败处理', fromTemplate.includes('工具失败时：任何一次工具调用失败'))
check('告警研判模板字段说明完整', fromTemplate.includes('first_checks: string[]'))

// 7) 模板库齐备且每套都能生成非空提示词。
for (const template of TEMPLATES) {
  const text = buildSystemPrompt(template.build())
  check(`模板「${template.label}」可生成提示词`, text.length > 0 && text.startsWith('# 身份'))
}

// 8) 数组条目里的空白行被丢弃，且不产生空行。
const withBlanks = buildSystemPrompt(form({ role: 'r', goal: 'g', rules: ['  第一条  ', '', '   '] }))
check('规则数组里的空白条目被丢弃并去首尾空格',
  withBlanks.includes('1. 第一条') && !withBlanks.includes('2. '))

if (failed > 0) {
  console.error(`\n${failed} 项自测未通过。`)
  process.exit(1)
}
console.log('\n全部行为自测通过。')
