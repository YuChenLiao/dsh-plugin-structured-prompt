/**
 * 导出/导入文档的行为测试。
 *
 * 这是**数据契约**：用户会把表单导出成文件、在别的会话导入、甚至手改 JSON。所以除了
 * 往返一致，还要验证"坏输入被挡住且说得出理由" —— 静默接受坏值会让问题推迟到构建
 * 提示词时才暴露（旧实现直接 `actions.setForm(JSON.parse(text))`，未知键会混进表单）。
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
  const built = TEMPLATES[0].build()
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

// ---- 6) 空白表单可往返（不能因为是空对象就出错） ----

const emptyDoc = parseFormDocument(JSON.stringify(serializeForm(createEmptyForm())))
check('空白表单往返无告警', emptyDoc.warnings.length === 0, emptyDoc.warnings.join('; '))

if (failed > 0) {
  console.error(`\n${failed} 项文档测试未通过。`)
  process.exit(1)
}
console.log('\n全部文档测试通过。')
