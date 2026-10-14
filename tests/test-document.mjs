/**
 * 文档契约测试。
 *
 * 两类"文档"都在这里守：
 *  - **导出/导入文档**：用户会把表单导出成文件、在别的会话导入、甚至手改 JSON。除了
 *    往返一致，还要验证"坏输入被挡住且说得出理由" —— 静默接受坏值会让问题推迟到构建
 *    提示词时才暴露（旧实现直接 `actions.setForm(JSON.parse(text))`，未知键会混进表单）。
 *  - **README**：表项数量、行数上限、分组与模板数量、槽位键与架构表、工具返回形状、工具名、
 *    `inject` 声明、依赖清单、仓库地址、文件清单、验证套清单、构建脚本路径、黄金文件的 LF
 *    契约。这些是能机器核对的硬事实，而 README 恰恰是本项目最容易在改实现时漏改的地方
 *    （已漏过 6 处），所以一律断言而不是靠人记。
 *
 * 前置条件：README 那一节会 import 客户端入口（走 react 与 store 桩），所以需要先跑过
 * `node tools/setup-dev-links.mjs`。
 *
 * 用法：node --import tsx --import ./tools/lib/loader-hook.mjs tests/test-document.mjs
 */
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'shared')
const forms = await import(pathToFileURL(resolve(SRC, 'forms.ts')).href)
const { TEMPLATES } = await import(pathToFileURL(resolve(SRC, 'templates.ts')).href)
const { OUTPUT_FORMAT_SKELETONS } = await import(pathToFileURL(resolve(SRC, 'prompt.ts')).href)

const {
  FORM_DOCUMENT_VERSION, serializeForm, parseFormDocument, completeForm, createEmptyForm,
} = forms

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail === '' ? '' : `\n      ${detail}`}`)
  if (!ok) failed += 1
}

/** 期待某次解析抛错，并返回错误信息。 */
const rejectionOf = (text) => {
  try {
    parseFormDocument(text)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// ---- 1) 导出形状 ----

const sample = completeForm({ role: '审计员', goal: '检查配置。', outputFormat: 'json' })
const doc = serializeForm(sample)
check('导出带 schema 版本号', doc.version === FORM_DOCUMENT_VERSION, String(doc.version))
check('导出把表单放在 form 字段下', typeof doc.form === 'object' && doc.form.role === '审计员')

// ---- 2) 往返一致 ----

const roundTrip = parseFormDocument(JSON.stringify(doc))
check('往返后无告警', roundTrip.warnings.length === 0, roundTrip.warnings.join('; '))
check('往返后字段逐项一致',
  JSON.stringify(completeForm(roundTrip.patch)) === JSON.stringify(sample))
check('模板表单也能往返', (() => {
  // 空模板库时 `TEMPLATES[0]` 是 undefined：用可选链并把这种情况落成 FAIL，而不是让整套以
  // `Cannot read properties of undefined` 结束（那样同一文件里后面的断言一条都不会执行）。
  const built = TEMPLATES[0]?.build()
  if (built === undefined) return false
  const back = parseFormDocument(JSON.stringify(serializeForm(built)))
  return JSON.stringify(completeForm(back.patch)) === JSON.stringify(built)
})())

// ---- 3) 向后兼容：早期没有版本号的裸表单 ----

const legacy = parseFormDocument(JSON.stringify({ role: '旧版', goal: '旧目标' }))
check('接受无版本号的旧导出文件', legacy.patch.role === '旧版' && legacy.patch.goal === '旧目标')
check('旧格式会给出说明', legacy.warnings.some(item => item.includes('没有版本号')),
  legacy.warnings.join('; '))

// ---- 4) 坏输入被挡住，且说得出理由 ----

/**
 * 用带版本号的文档包一层。
 * @param form - 表单片段。
 * @returns 文档 JSON。
 */
const docOf = (form) => JSON.stringify({ version: FORM_DOCUMENT_VERSION, form })

const unknownKey = parseFormDocument(docOf({ role: 'r', goal: 'g', evil: 'x' }))
check('未知字段被丢弃', !('evil' in unknownKey.patch))
check('未知字段有告警', unknownKey.warnings.some(item => item.includes('evil')), unknownKey.warnings.join('; '))

const wrongType = parseFormDocument(docOf({ role: 'r', goal: 'g', rules: 'not-an-array', fallback: 123 }))
check('类型不符的字段被丢弃', !('rules' in wrongType.patch) && !('fallback' in wrongType.patch))
check('类型不符有告警', wrongType.warnings.length === 2, wrongType.warnings.join('; '))

const badEnum = parseFormDocument(docOf({ role: 'r', goal: 'g', outputFormat: 'csv', toolPolicy: 'sometimes' }))
check('越界枚举被丢弃', !('outputFormat' in badEnum.patch) && !('toolPolicy' in badEnum.patch))
check('越界枚举有告警', badEnum.warnings.length === 2, badEnum.warnings.join('; '))

check('合法枚举被接受', (() => {
  const ok = parseFormDocument(docOf({
    role: 'r', goal: 'g', outputFormat: 'table', toolPolicy: 'manual', callableTools: ['a'],
  }))
  return ok.patch.outputFormat === 'table' && ok.patch.toolPolicy === 'manual'
    && ok.patch.callableTools?.[0] === 'a' && ok.warnings.length === 0
})())
check('覆盖全部骨架格式都能被接受',
  Object.keys(OUTPUT_FORMAT_SKELETONS).every((format) => {
    const parsed = parseFormDocument(docOf({ role: 'r', goal: 'g', outputFormat: format }))
    return parsed.patch.outputFormat === format && parsed.warnings.length === 0
  }))

// 更新的版本号：不拒绝，但要说清楚会发生什么。
const future = parseFormDocument(JSON.stringify({
  version: FORM_DOCUMENT_VERSION + 5, form: { role: 'r', goal: 'g' },
}))
check('更新的文档版本可读且给出告警',
  future.patch.role === 'r' && future.warnings.some(item => item.includes('比本插件支持的')),
  future.warnings.join('; '))

// ---- 5) 结构性错误直接拒绝 ----

check('非法 JSON 被拒绝', (rejectionOf('{ not json') ?? '').includes('JSON'))
check('顶层是数组被拒绝', rejectionOf('[1,2]') !== null)
check('顶层是标量被拒绝', rejectionOf('"str"') !== null)
check('缺 version 的正整数校验',
  rejectionOf(JSON.stringify({ version: 0, form: {} })) !== null
  && rejectionOf(JSON.stringify({ version: '1', form: {} })) !== null)
check('form 不是对象被拒绝', rejectionOf(JSON.stringify({ version: 1, form: [] })) !== null)

// `form` 这个键不能作为"版本化文档"的独立标志：用户手写 {form:{...}} 却忘写 version 时，
// 旧判定会报出与内容无关的「version 必须是正整数」。但也不能因此把内容整份丢掉 ——
// 调用方拿到空 patch 会覆盖表单、把用户已填的内容清空。所以按 form 字段的内容解析并告警。
const formNoVersion = parseFormDocument(JSON.stringify({ form: { role: 'r', goal: 'g' } }))
check('{form:...} 缺版本号时按 form 字段的内容解析',
  formNoVersion.warnings.some(item => item.includes('缺少版本号')), formNoVersion.warnings.join('; '))
check('{form:...} 的内容被解析出来而不是丢弃',
  formNoVersion.patch.role === 'r' && formNoVersion.patch.goal === 'g',
  JSON.stringify(formNoVersion.patch))

// 契约：根本无法识别的文件会得到空 patch —— 调用方必须据此拒绝导入。
// （`setForm` 是整体替换，用空 patch 覆盖等于清空表单。）
check('无法识别的文件得到空 patch',
  Object.keys(parseFormDocument(JSON.stringify({ nope: 1 })).patch).length === 0)
check('空 patch 不携带任何字段',
  Object.keys(parseFormDocument(JSON.stringify({ form: 1 })).patch).length === 0)

// ---- 6) 空白表单可往返（不能因为是空对象就出错） ----

const emptyDoc = parseFormDocument(JSON.stringify(serializeForm(createEmptyForm())))
check('空白表单往返无告警', emptyDoc.warnings.length === 0, emptyDoc.warnings.join('; '))

// ---- 7) README 里的硬事实与实现一致 ----
//
// 理由见文件头：README 是本项目最容易在改实现时漏改的地方，凡是能机器核对的都放这里。
// 每条都从 README 文本里取"声明值"，再与实现（源码里的常量、清单、其它测试脚本）比较
// —— 两边各写一份数字不叫断言。

const { readFileSync, readdirSync, statSync, existsSync } = await import('node:fs')

const PLUGIN_ROOT = resolve(SRC, '..', '..')
const readme = readFileSync(resolve(PLUGIN_ROOT, 'README.md'), 'utf8')
const manifest = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, 'package.json'), 'utf8'))

/** 中文数字：README 里的计数写成「四组」「八套」。 */
const CN_NUMBERS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/**
 * 取 README 里某个中文计数。
 * @param pattern - 捕获组为中文数字的正则。
 * @returns 数字；没写或写得不认识时为 0。
 */
const readmeCount = (pattern) => CN_NUMBERS[pattern.exec(readme)?.[1] ?? ''] ?? 0

/**
 * 导入一个模块并把失败降级成断言。
 *
 * 模块图断裂（源码文件被改名/删除）时落成一条**命名的 FAIL**，而不是让整套以未捕获异常
 * 结束 —— 否则"文档漂移"的红会以 `ERR_MODULE_NOT_FOUND` 出现，无从诊断。
 * @param label - 断言名里用的标签。
 * @param url - 模块 URL。
 * @returns 模块命名空间；导入失败时为 `null`。
 */
const importEntry = async (label, url) => {
  try {
    return await import(url)
  } catch (error) {
    check(`${label}可以导入`, false, String(error))
    return null
  }
}

const clientModule = await importEntry(
  '客户端入口', pathToFileURL(resolve(SRC, '..', 'client', 'index.ts')).href,
)
const hostModule = await importEntry('host 入口', pathToFileURL(resolve(SRC, '..', 'index.ts')).href)
const { SECTIONS } = (await importEntry(
  '分组元数据', pathToFileURL(resolve(SRC, '..', 'client', 'ui', 'config.ts')).href,
)) ?? {}
const { TOOL_OUTPUT_SCHEMA } = (await importEntry(
  '工具参数与输出 schema', pathToFileURL(resolve(SRC, '..', 'host', 'parameters.ts')).href,
)) ?? {}

check('README 的表项数量与实际字段数一致', (() => {
  const declared = Number(/## 表单项（(\d+) 项）/.exec(readme)?.[1] ?? 0)
  const actual = Object.keys(createEmptyForm()).length
  console.log(`      README=${declared} 实际=${actual}`)
  return declared === actual && declared > 0
})())

check('README 的行数上限与 verify-install.mjs 的常量一致', (() => {
  const declared = Number(/单文件不超过 \*\*(\d+) 行\*\*/.exec(readme)?.[1] ?? 0)
  const installed = readFileSync(resolve(PLUGIN_ROOT, 'tests', 'verify-install.mjs'), 'utf8')
  const enforced = Number(/MAX_SOURCE_LINES = (\d+)/.exec(installed)?.[1] ?? 0)
  console.log(`      README=${declared} 常量=${enforced}`)
  return declared === enforced && declared > 0
})())

// 分组与模板数量：README 写「四组」「四套模板」，必须与元数据、模板库一致。
const declaredGroups = readmeCount(/([一二三四五六七八九十])组、默认只展开/)
check('README 的分组数量与实际一致', declaredGroups > 0 && declaredGroups === (SECTIONS?.length ?? -1),
  `README=${declaredGroups} 实际=${SECTIONS?.length ?? -1}`)
const declaredTemplates = readmeCount(/([一二三四五六七八九十])套模板/)
check('README 的模板数量与实际一致',
  declaredTemplates > 0 && declaredTemplates === TEMPLATES.length,
  `README=${declaredTemplates} 实际=${TEMPLATES.length}`)

// 槽位：README 提到的 `conversation.input.*` 必须正好是实际注册的两个；架构表里逐行给出的
// 槽位也要与注册一一对应（只比较去重后的集合会漏掉"表格里两行写成同一个键"）。
const registeredSlots = clientModule === null
  ? []
  : clientModule.slotEntries({ create: () => ({}) }, () => {}).map(entry => entry.name).sort()
const readmeSlots = [...new Set(
  [...readme.matchAll(/`(conversation\.input\.[a-z.]+)`/g)].map(match => match[1]),
)].sort()
check('README 的槽位键与注册的槽位一致',
  registeredSlots.length > 0 && readmeSlots.join(',') === registeredSlots.join(','),
  `README=${readmeSlots.join(',')} 实际=${registeredSlots.join(',')}`)
const slotTableKeys = [...readme.matchAll(/\| `(conversation\.input\.[a-z.]+)`（list） \|/g)]
  .map(match => match[1])
check('README 架构表的槽位行与注册一一对应',
  slotTableKeys.length === registeredSlots.length
  && [...slotTableKeys].sort().join(',') === registeredSlots.join(','),
  `表格=${slotTableKeys.join(',')} 实际=${registeredSlots.join(',')}`)

// 工具返回形状：README 表格里列的字段名必须等于输出 schema 的 required。
const declaredReturn = (/`\{ ([\w, ]+) \}`/.exec(readme)?.[1] ?? '')
  .split(', ').filter(name => name !== '').sort().join(',')
const actualReturn = [...(TOOL_OUTPUT_SCHEMA?.required ?? [])].sort().join(',')
check('README 的工具返回形状与输出 schema 一致',
  actualReturn !== '' && declaredReturn === actualReturn,
  `README={${declaredReturn}} 实际={${actualReturn}}`)

// 工具名：README 引用的名字必须与实现里的常量一致。
const toolName = /STRUCTURED_PROMPT_TOOL = '([^']+)'/
  .exec(readFileSync(resolve(SRC, '..', 'host', 'tool.ts'), 'utf8'))?.[1] ?? ''
check('README 提到的工具名与实际一致',
  toolName !== '' && readme.includes(`\`${toolName}\``), toolName)

// inject 声明：README 里出现的每一处 `inject: [...]` 都要与实际导出一致 —— 只查"某处写对
// 了"会让别处的错值漏检。
const declaredInjects = [...readme.matchAll(/inject: \[([^\]]*)\]/g)]
  .map(match => (match[1] ?? '').replace(/['\s]/g, ''))
const actualInjects = new Set([
  (clientModule?.inject ?? []).join(','),
  (hostModule?.inject ?? []).join(','),
])
check('README 里出现的 inject 声明都与实现一致',
  declaredInjects.length > 0 && declaredInjects.every(value => actualInjects.has(value)),
  `README=${declaredInjects.join(' | ')} 实际=${[...actualInjects].join(' | ')}`)

// 依赖清单：README 声明"没有 devDependency、不执行 npm install"，包清单必须一致。
const claimsNoDevDeps = /\*\*没有 devDependency\*\*/.test(readme)
check('README 的「没有 devDependency」与包清单一致',
  claimsNoDevDeps && manifest.devDependencies === undefined && manifest.dependencies === undefined,
  `README=${claimsNoDevDeps} devDeps=${String(manifest.devDependencies)} deps=${String(manifest.dependencies)}`)

// 安装命令指向本包：README 的 `github:<owner>/<repo>` 必须与清单里的仓库地址一致。
const ownedRepo = /github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git|#|$)/
  .exec(manifest.repository?.url ?? '')?.[1] ?? ''
check('README 的安装命令指向本包',
  ownedRepo !== '' && readme.includes(`github:${ownedRepo}`), `清单=${ownedRepo}`)

// 文件清单：README 提到的每个源文件/脚本名都要真实存在。代码结构树里的条目多为相对文件
// 名（`ui/Trigger.tsx`、`tool.ts`），所以按文件名核对；带 src/tests/tools 前缀的完整路径
// 再按路径核对一次（能抓住"指错半边"，例如把 host 入口写成 src/client/index.ts）。
const SKIP_DIRS = new Set(['.git', '.dev-deps', 'node_modules'])
const repoFiles = new Set()
/**
 * 递归收集仓库里的文件名（跳过 VCS、开发期依赖与 node_modules）。
 * @param dir - 目录绝对路径。
 */
const collectNames = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = resolve(dir, entry)
    if (statSync(full).isDirectory()) collectNames(full)
    else repoFiles.add(entry)
  }
}
collectNames(PLUGIN_ROOT)
const declaredNames = [...new Set(
  // 不限反引号：代码结构树整块是 ```text，里面没有反引号，只抓反引号会漏掉绝大多数清单项。
  // 含 `.json`：README 会提到 `package.json`、`tsconfig.json` 与模板库的 `templates.json`。
  [...readme.matchAll(/([\w-]+(?:\.[\w-]+)*\.(?:tsx?|mjs|json))\b/g)]
    // 排除外部工具的路径（README 里给过 tsx 自己的 loader 绝对路径），它们不属于本仓库。
    .filter(match => !readme.slice(Math.max(0, match.index - 40), match.index).includes('node_modules/'))
    .map(match => match[1]),
)]
const unknownNames = declaredNames.filter(name => !repoFiles.has(name))
check('README 提到的源文件/脚本都存在', unknownNames.length === 0, unknownNames.join(', '))
// 反向核对：`src/` 下的每个文件都要被 README 提到。只做单向检查时新增文件不会让断言变红 ——
// 结构树曾经漏掉过 `host/config.ts`，而按 basename 的存在性检查被 `ui/config.ts` 满足了。
const srcFiles = new Set()
/**
 * 收集 `src/` 下的文件名。
 * @param dir - 目录绝对路径。
 */
const collectSrcNames = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry)
    if (statSync(full).isDirectory()) collectSrcNames(full)
    else srcFiles.add(entry)
  }
}
collectSrcNames(resolve(PLUGIN_ROOT, 'src'))
const undocumented = [...srcFiles].filter(name => !declaredNames.includes(name))
check('README 的文件清单覆盖了 src/ 下的每个文件', undocumented.length === 0,
  `${undocumented.join(', ')}（已列 ${declaredNames.length} 个名字）`)
check('README 的文件清单覆盖面足够（不是只列了两三个文件）', declaredNames.length >= 35,
  `${declaredNames.length} 个`)
const declaredPaths = [...new Set(
  [...readme.matchAll(/((?:src|tests|tools)\/[\w./-]+\.(?:d\.ts|tsx?|mjs))/g)].map(match => match[1]),
)]
const missingPaths = declaredPaths.filter(rel => !existsSync(resolve(PLUGIN_ROOT, rel)))
check('README 里的完整路径都存在',
  declaredPaths.length >= 5 && missingPaths.length === 0,
  `缺失=${missingPaths.join(', ') || '(无)'} 共 ${declaredPaths.length} 个`)

// 验证套清单与套数：README 注释块里的名字必须与 run-tests.mjs 的 SUITES 同名同序，数量也要对上。
const runnerSource = readFileSync(resolve(PLUGIN_ROOT, 'tools', 'run-tests.mjs'), 'utf8')
const suiteNames = [...runnerSource.matchAll(/name: '([^']+)'/g)].map(match => match[1])
const suiteBlock = /全部验证（[^）]*）[：:]([\s\S]*?)\nnode tools\/run-tests\.mjs/.exec(readme)?.[1] ?? ''
const declaredSuites = [...suiteBlock.matchAll(/[^\s+#]+/g)]
  .map(match => match[0])
  .filter(name => suiteNames.includes(name))
check('README 的验证套清单与 run-tests.mjs 同名同序',
  suiteNames.length > 0
  && declaredSuites.length === suiteNames.length
  && suiteNames.every((name, index) => declaredSuites[index] === name),
  `README=${declaredSuites.join('+')} 实际=${suiteNames.join('+')}`)
const declaredSuiteCount = readmeCount(/全部验证（([一二三四五六七八九十])套）/)
check('README 声明的验证套数量与实际一致',
  declaredSuiteCount > 0 && declaredSuiteCount === suiteNames.length,
  `README=${declaredSuiteCount} 实际=${suiteNames.length}`)

// ---- 8) 模板 JSON：形状、唯一性与场景说明 ----
//
// `src/shared/templates.json` 是模板的单一真源，也是**文件边界**：字段名写错、取值越界都要在
// 这里先红，而不是等构建期抛错（构建期才发现会挡住整条流水线）。
const { FIELD_SHAPES, matchesShape } = forms
const templateDoc = JSON.parse(readFileSync(resolve(SRC, 'templates.json'), 'utf8'))
const rawTemplates = templateDoc.templates

check('模板 JSON 带 schema 版本号', templateDoc.version === 1 && Array.isArray(rawTemplates))
check('每套模板都有 id / label / whenToUse / fields',
  rawTemplates.every(item => typeof item.id === 'string' && item.id !== ''
    && typeof item.label === 'string' && item.label !== ''
    && typeof item.whenToUse === 'string' && item.whenToUse !== ''
    && typeof item.fields === 'object' && item.fields !== null),
  rawTemplates.map(item => item.id).join(', '))
const templateIds = rawTemplates.map(item => item.id)
check('模板 id 唯一', new Set(templateIds).size === templateIds.length, templateIds.join(', '))
check('模板 id 都是 kebab-case 短名',
  templateIds.every(id => /^[a-z][a-z0-9-]*$/.test(id)), templateIds.join(', '))
check('每套模板的字段名与取值都符合表单形状',
  rawTemplates.every(item => Object.entries(item.fields ?? {}).every(([key, value]) => {
    const shape = FIELD_SHAPES[key]
    return shape !== undefined && matchesShape(value, shape)
  })),
  rawTemplates.map(item => {
    const bad = Object.entries(item.fields ?? {}).filter(([key, value]) => {
      const shape = FIELD_SHAPES[key]
      return shape === undefined || !matchesShape(value, shape)
    })
    return bad.length === 0 ? '' : `${item.id}: ${bad.map(([key]) => key).join('/')}`
  }).filter(Boolean).join(', '))
// 注意：这条不只是"模板质量"检查，它还是「参数边界允许模板补 role/goal」的**安全前提** ——
// 一旦某套模板缺了这两项，放宽就会真的放出没有身份的产物。别把它当成可删的软断言。
check('每套模板都填了 role 与 goal（模板要能独立产出提示词）',
  rawTemplates.every(item => typeof item.fields?.role === 'string' && item.fields.role !== ''
    && typeof item.fields?.goal === 'string' && item.fields.goal !== ''))
// whenToUse 会常驻工具 schema（每步都在上下文里），所以长度本身是契约的一部分。
check('whenToUse 是一句话（≤40 字，它是常驻成本）',
  rawTemplates.every(item => item.whenToUse.length <= 40),
  rawTemplates.filter(item => item.whenToUse.length > 40).map(item => item.id).join(', '))
const { buildSystemPrompt } = await import(pathToFileURL(resolve(SRC, 'prompt.ts')).href)
// 逐套构建并把异常落成**命名 FAIL**：坏数据不该让整套以未捕获异常结束（那样这节剩余断言一条都
// 不会执行、也没有可读的失败名）。
const templateProblems = TEMPLATES.flatMap(template => {
  try {
    return buildSystemPrompt(template.build()).startsWith('# 身份')
      ? [] : [`${template.id}: 产物不是以「# 身份」开头`]
  } catch (error) {
    return [`${template.id}: ${error instanceof Error ? error.message : String(error)}`]
  }
})
check('每套模板都能构建出以「# 身份」开头的提示词',
  TEMPLATES.length === rawTemplates.length && templateProblems.length === 0,
  `${TEMPLATES.length} 套${templateProblems.length === 0 ? '' : `；问题：${templateProblems.join('; ')}`}`)
check('README 的模板清单里出现了每套模板的 label',
  TEMPLATES.every(template => readme.includes(template.label)),
  TEMPLATES.map(template => template.label).join('、'))

// 构建脚本路径：README 给的命令存在，不等于 tools/package.json 的 script 也存在 —— 后者
// 恰恰刚修过一次（指向了不存在的 tools/build.mjs）。npm 的 cwd 是 package.json 所在目录，
// 所以相对路径按 tools/ 解析。
const toolsManifest = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, 'tools', 'package.json'), 'utf8'))
const scriptPaths = Object.values(toolsManifest.scripts ?? {})
  .flatMap(command => [...command.matchAll(/node\s+([\w./-]+)/g)].map(match => match[1]))
const missingScripts = scriptPaths.filter(rel => !existsSync(resolve(PLUGIN_ROOT, 'tools', rel)))
check('tools/package.json 的 script 路径都存在（cwd 是 tools/）',
  scriptPaths.length > 0 && missingScripts.length === 0, missingScripts.join(', '))

// 黄金文件的换行契约：README 把它列为硬性契约之一，`.gitattributes` 是它的执行处。
const attributes = readFileSync(resolve(PLUGIN_ROOT, '.gitattributes'), 'utf8')
check('黄金文件的 LF 契约仍在 .gitattributes 里',
  /tests\/golden\/\*\.txt text eol=lf/.test(attributes))

if (failed > 0) {
  console.error(`\n${failed} 项文档测试未通过。`)
  process.exit(1)
}
console.log('\n全部文档测试通过。')
