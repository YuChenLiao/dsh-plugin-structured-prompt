/**
 * 结构化提示词构建核心。
 *
 * 段落顺序与格式与原始实现一致：
 *   身份 → 目标 → 硬性规则（必须遵守，优先于其他任何要求）→ 工具使用策略
 *   → 输出格式 → 数据不足时 → 示例
 * 非空段落之间以单个空行连接，空段落整体省略；扩写字段都并入既有段落，没有
 * 新增顶层段落。
 */
import type { OutputFormat, PromptForm } from './types.js'

/** 把文本按行清洗：去掉行尾空白、折叠连续空行、去首尾空行。 */
function normalizeBlock(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 逐条清洗数组：丢弃空白条目并去掉首尾空白。 */
function cleanList(items: readonly string[]): string[] {
  return items.map(item => item.trim()).filter(item => item !== '')
}

/** 输出格式类型到 `outputSpec` 骨架的映射（用户可在表单里再改）。 */
export const OUTPUT_FORMAT_SKELETONS: Record<Exclude<OutputFormat, ''>, string> = {
  json: [
    '以 JSON 输出，字段如下：',
    '- field_name: type  // 说明',
  ].join('\n'),
  markdown: [
    '以 Markdown 输出，结构如下：',
    '## 结论',
    '## 依据',
    '## 后续动作',
  ].join('\n'),
  table: [
    '以 Markdown 表格输出，列如下：',
    '| 项 | 值 | 说明 |',
    '| --- | --- | --- |',
  ].join('\n'),
  text: '以纯文本输出，先给结论，再给依据，不要使用 Markdown 标记。',
}

/** 工具调用策略为「自动」时的固定引导语。 */
const TOOL_POLICY_AUTO = '由你根据任务需要自行判断并选择要调用的工具；不需要工具时直接回答。'

/**
 * 手动模式下按用户点名的工具生成指定调用语句。
 *
 * 工具名与用途按**原始索引**配对：用途可以留空（只写工具名），工具名留空的行
 * 整体忽略。这里刻意不先过滤数组 —— 过滤会丢掉空串、让用途与工具名错位。
 *
 * 也不做"从已安装清单里勾选"：DSH 的插件清单列的是自带插件而非用户安装的插件，
 * 工具检索属于输入框 `/` 菜单的职责，表单只负责把用户点名的工具写进提示词。
 * @param tools - 用户填写的工具名（可含空串）。
 * @param slots - 与 `tools` 索引对齐的用途说明（可含空串）。
 * @returns 策略说明文本；没有任何有效工具时返回空串。
 */
function manualPolicyText(tools: readonly string[], slots: readonly string[]): string {
  const lines = tools
    .map((rawTool, index) => {
      const tool = rawTool.trim()
      if (tool === '') return ''
      const purpose = (slots[index] ?? '').trim()
      return purpose === '' ? `- ${tool}` : `- ${tool}：${purpose}`
    })
    .filter(line => line !== '')
  if (lines.length === 0) return ''
  return [
    '只允许调用下列已指定的工具，其余工具一律不要使用：',
    ...lines,
  ].join('\n')
}

/**
 * 构建结构化系统提示词。
 * @param form - 表单字段。
 * @returns 组装后的提示词；身份与目标均为空时返回空串。
 */
export function buildSystemPrompt(form: PromptForm): string {
  const rules = cleanList(form.rules)
  const forbidden = cleanList(form.forbidden)
  const guidance = cleanList(form.toolGuidance)
  const fields = cleanList(form.fields)

  // 身份段：背景与上下文作为同一段的补充行。
  const identity = [normalizeBlock(form.role), normalizeBlock(form.background)]
    .filter(text => text !== '')
    .join('\n')

  // 目标段：成功标准作为完成判据行。
  const success = normalizeBlock(form.successCriteria)
  const goal = [normalizeBlock(form.goal), success === '' ? '' : `完成标准：${success}`]
    .filter(text => text !== '')
    .join('\n')

  // 硬性规则段：编号规则在前，禁止行为作为同段子块。
  const rulesBody = [
    rules.length === 0 ? '' : rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n'),
    forbidden.length === 0
      ? ''
      : ['禁止行为（同样不可违反）：', ...forbidden.map(item => `- ${item}`)].join('\n'),
  ].filter(text => text !== '').join('\n')

  // 工具使用策略段：策略引导语 + 逐条策略 + 失败处理。
  const policyLine = form.toolPolicy === 'auto'
    ? TOOL_POLICY_AUTO
    : form.toolPolicy === 'manual'
      // 刻意不经过 cleanList：过滤空串会让用途与工具名的索引错位。
      ? manualPolicyText(form.callableTools, form.toolSlots)
      : ''
  const toolFailure = normalizeBlock(form.toolFailure)
  const guidanceBody = [
    policyLine,
    guidance.length === 0 ? '' : guidance.map(item => `- ${item}`).join('\n'),
    toolFailure === '' ? '' : `工具失败时：${toolFailure}`,
  ].filter(text => text !== '').join('\n')

  // 输出格式段：格式类型骨架 → 字段级说明 → 表达要求 → 自定义说明。
  const languageTone = normalizeBlock(form.languageTone)
  const outputBody = [
    form.outputFormat === '' ? '' : OUTPUT_FORMAT_SKELETONS[form.outputFormat],
    fields.length === 0 ? '' : ['字段说明：', ...fields.map(item => `- ${item}`)].join('\n'),
    languageTone === '' ? '' : `表达要求：${languageTone}`,
    normalizeBlock(form.outputSpec),
  ].filter(text => text !== '').join('\n')

  const fallback = normalizeBlock(form.fallback)
  const examples = normalizeBlock(form.examples)

  return [
    identity === '' ? '' : `# 身份\n${identity}`,
    goal === '' ? '' : `# 目标\n${goal}`,
    rulesBody === '' ? '' : `# 硬性规则（必须遵守，优先于其他任何要求）\n${rulesBody}`,
    guidanceBody === '' ? '' : `# 工具使用策略\n${guidanceBody}`,
    outputBody === '' ? '' : `# 输出格式\n${outputBody}`,
    fallback === '' ? '' : `# 数据不足时\n${fallback}`,
    examples === '' ? '' : `# 示例\n${examples}`,
  ].filter(section => section !== '').join('\n\n')
}

/**
 * 必填校验：身份与目标。
 * @param form - 表单字段。
 * @returns 缺失的必填字段名；全部填写时为空数组。
 */
export function validateForm(form: PromptForm): string[] {
  const missing: string[] = []
  if (normalizeBlock(form.role) === '') missing.push('身份')
  if (normalizeBlock(form.goal) === '') missing.push('目标')
  return missing
}
