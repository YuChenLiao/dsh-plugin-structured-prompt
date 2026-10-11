/**
 * 结构化提示词构建核心。
 *
 * 段落顺序与格式严格保持与原始实现一致：
 *   身份 → 目标 → 硬性规则（必须遵守，优先于其他任何要求）→ 工具使用策略
 *   → 输出格式 → 数据不足时 → 示例
 * 非空段落之间以单个空行连接，空段落整体省略。
 *
 * 扩写字段都落在既有段落的语义位置上（例如「背景与上下文」并入身份段、
 * 「禁止行为」作为硬性规则段的子块），因此没有引入新的顶层段落。
 */

/** 把文本按行清洗：去掉行尾空白、折叠连续空行、去首尾空行。 */
function normalizeBlock(text) {
  if (typeof text !== 'string') return ''
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd())
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 逐条清洗数组：丢弃空白条目并去掉首尾空白。 */
function cleanList(items) {
  if (!Array.isArray(items)) return []
  return items.map(item => (typeof item === 'string' ? item.trim() : '')).filter(item => item !== '')
}

/** 输出格式类型到 `outputSpec` 骨架的映射（用户可在表单里再改）。 */
export const OUTPUT_FORMAT_SKELETONS = {
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

/** 工具调用策略的固定引导语。 */
const TOOL_POLICY_AUTO = '由你根据任务需要自行判断并选择要调用的工具；不需要工具时直接回答。'

/**
 * 手动模式下按用户点名的工具生成指定调用语句。
 *
 * 工具名与用途按**原始索引**配对：用途可以留空（只写工具名），也可以只有用途
 * 而工具名留空（该行整体忽略）。这里刻意不先过滤数组 —— 过滤会丢掉空串、让
 * 用途与工具名错位。
 *
 * 也不做"从已安装清单里勾选"—— DSH 的插件清单列的是自带插件而非用户安装的
 * 插件，工具检索属于输入框 `/` 菜单的职责，表单只负责把用户点名的工具写进提示词。
 * @param tools - 用户填写的工具名（可含空串）。
 * @param slots - 与 `tools` 索引对齐的用途说明（可含空串）。
 * @returns 策略说明文本；没有任何有效工具时返回空串。
 */
function manualPolicyText(tools, slots) {
  const lines = tools
    .map((rawTool, index) => {
      const tool = (rawTool ?? '').trim()
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
 * @param form - 表单字段（见 store.js 的 PromptForm）。
 * @returns 组装后的提示词；身份与目标均为空时返回空串。
 */
export function buildSystemPrompt(form) {
  const rules = cleanList(form.rules)
  const forbidden = cleanList(form.forbidden)
  const guidance = cleanList(form.toolGuidance)
  const fields = cleanList(form.fields)

  // 身份段：背景与上下文作为同一段的补充行。
  const identity = [
    normalizeBlock(form.role),
    normalizeBlock(form.background),
  ].filter(Boolean).join('\n')

  // 目标段：成功标准作为完成判据行。
  const goal = [
    normalizeBlock(form.goal),
    normalizeBlock(form.successCriteria) === '' ? '' : `完成标准：${normalizeBlock(form.successCriteria)}`,
  ].filter(Boolean).join('\n')

  // 硬性规则段：编号规则在前，禁止行为作为同段子块。
  const rulesBody = [
    rules.length === 0 ? '' : rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n'),
    forbidden.length === 0
      ? ''
      : ['禁止行为（同样不可违反）：', ...forbidden.map(item => `- ${item}`)].join('\n'),
  ].filter(Boolean).join('\n')

  // 工具使用策略段：策略引导语 + 逐条策略 + 失败处理。
  const policyLine = form.toolPolicy === 'auto'
    ? TOOL_POLICY_AUTO
    : form.toolPolicy === 'manual'
      // 刻意不经过 cleanList：过滤空串会让用途与工具名的索引错位。
      ? manualPolicyText(form.callableTools ?? [], form.toolSlots ?? [])
      : ''
  const guidanceBody = [
    policyLine,
    guidance.length === 0 ? '' : guidance.map(item => `- ${item}`).join('\n'),
    normalizeBlock(form.toolFailure) === '' ? '' : `工具失败时：${normalizeBlock(form.toolFailure)}`,
  ].filter(Boolean).join('\n')

  // 输出格式段：格式类型骨架 → 字段级说明 → 表达要求 → 自定义说明。
  const outputBody = [
    form.outputFormat === '' ? '' : (OUTPUT_FORMAT_SKELETONS[form.outputFormat] ?? ''),
    fields.length === 0 ? '' : ['字段说明：', ...fields.map(item => `- ${item}`)].join('\n'),
    normalizeBlock(form.languageTone) === '' ? '' : `表达要求：${normalizeBlock(form.languageTone)}`,
    normalizeBlock(form.outputSpec),
  ].filter(Boolean).join('\n')

  return [
    identity === '' ? '' : `# 身份\n${identity}`,
    goal === '' ? '' : `# 目标\n${goal}`,
    rulesBody === '' ? '' : `# 硬性规则（必须遵守，优先于其他任何要求）\n${rulesBody}`,
    guidanceBody === '' ? '' : `# 工具使用策略\n${guidanceBody}`,
    outputBody === '' ? '' : `# 输出格式\n${outputBody}`,
    normalizeBlock(form.fallback) === '' ? '' : `# 数据不足时\n${normalizeBlock(form.fallback)}`,
    normalizeBlock(form.examples) === '' ? '' : `# 示例\n${normalizeBlock(form.examples)}`,
  ].filter(Boolean).join('\n\n')
}

/** 必填校验：身份与目标。 */
export function validateForm(form) {
  const missing = []
  if (normalizeBlock(form.role) === '') missing.push('身份')
  if (normalizeBlock(form.goal) === '') missing.push('目标')
  return missing
}

/** 原始使用示例：一键填充用的「告警研判」模板。 */
export const ALERT_TRIAGE_TEMPLATE = {
  role: '你是一名负责线上稳定性的 SRE 助手，服务于一个日订单量百万级的电商系统。',
  goal: '根据监控数据判断告警是否需要人工立即介入，并给出首要排查方向。',
  background: '',
  successCriteria: '',
  rules: [
    '只能基于工具返回的数据下结论，不得引用记忆中其他系统的经验值。',
    '所有数值必须带上单位和时间窗口，例如 940ms / 近 5 分钟。',
    '阈值判断必须以指标配置为准；配置缺失时明确说明缺失，不要用默认值代替。',
  ],
  forbidden: ['不得输出任何猜测性的根因结论（例如“疑似数据库慢查询”）。'],
  // 策略留「自动」：需要点名工具时由用户切到手动再填写。
  toolPolicy: 'auto',
  callableTools: [],
  toolSlots: [],
  toolGuidance: [
    '先调用 query_metrics 拿指标，再调用 get_threshold_config 拿阈值，顺序不可颠倒。',
    '如果指标数据的时间窗口与阈值配置不一致，先调用 list_metric_windows 确认可用窗口。',
  ],
  toolFailure: '任何一次工具调用失败，最多重试一次；仍失败则直接报告失败，不要用估计值代替。',
  outputSpec: '',
  outputFormat: 'json',
  languageTone: '',
  fields: [
    'severity: "P0" | "P1" | "P2" | "info"',
    'metric: { name, value, unit, window }',
    'threshold: { value, unit, source } 或 null',
    'breached: boolean',
    'first_checks: string[]  // 1-3 条首要排查方向',
    'data_gaps: string[]     // 缺失的数据项，没有则空数组',
  ],
  fallback: '若关键指标或阈值任一缺失，severity 返回 "info"，并在 data_gaps 中列出缺失项。禁止编造数值。',
  examples: '',
}

/** 内置模板库：填充的是表单字段，不是成稿提示词。 */
export const TEMPLATES = [
  {
    id: 'alert-triage',
    label: '告警研判（原始示例）',
    build: () => ({ ...ALERT_TRIAGE_TEMPLATE }),
  },
  {
    id: 'code-review',
    label: '代码审查',
    build: () => ({
      role: '你是一名严格的高级工程师，负责对提交的改动做缺陷导向的代码审查。',
      goal: '找出改动中会导致线上故障、数据错误或安全问题的缺陷，并按严重度排序。',
      background: '',
      successCriteria: '每条结论都能指向具体文件与代码位置；没有发现缺陷时明确说明。',
      rules: [
        '只审查本次改动涉及的范围，不扩展评审范围。',
        '每条问题必须给出文件路径与行号。',
      ],
      forbidden: ['不得提出纯粹的风格偏好（命名、空行、注释密度）。'],
      toolPolicy: 'auto',
      callableTools: [],
      toolSlots: [],
      toolGuidance: ['先读取改动范围内的文件，再下结论。'],
      toolFailure: '读取失败时明确说明哪些文件未能读取，不要凭猜测补充内容。',
      outputSpec: '',
      outputFormat: 'json',
      languageTone: '简洁直接，中文，不写客套话。',
      fields: [
        'severity: "blocker" | "major" | "minor"',
        'file: string',
        'line: number',
        'problem: string',
        'suggestion: string',
      ],
      fallback: '若无法获取完整改动内容，返回空数组并在 summary 中说明原因。',
      examples: '',
    }),
  },
  {
    id: 'data-extract',
    label: '数据提取',
    build: () => ({
      role: '你是一名数据抽取助手，把非结构化文本转换为结构化记录。',
      goal: '从输入文本中抽取指定字段，输出可直接入库的记录。',
      background: '',
      successCriteria: '每条记录字段齐全且与原文一致。',
      rules: ['字段值必须逐字来自原文，不得改写或补全。'],
      forbidden: ['不得编造原文中不存在的字段值。'],
      toolPolicy: 'auto',
      callableTools: [],
      toolSlots: [],
      toolGuidance: [],
      toolFailure: '',
      outputSpec: '',
      outputFormat: 'json',
      languageTone: '',
      fields: ['records: object[]  // 每条记录一条'],
      fallback: '字段在原文中缺失时填 null，并在 missing 数组中列出字段名。禁止编造。',
      examples: '',
    }),
  },
  {
    id: 'report',
    label: '报告撰写',
    build: () => ({
      role: '你是一名技术分析师，把已有材料整理成可决策的报告。',
      goal: '基于给定材料输出一份结论先行、依据可追溯的简报。',
      background: '',
      successCriteria: '读者能在第一段拿到结论与建议。',
      rules: ['结论必须由给出的材料支撑，不引入材料之外的事实。'],
      forbidden: ['不得虚构数据、时间或引用来源。'],
      toolPolicy: 'auto',
      callableTools: [],
      toolSlots: [],
      toolGuidance: [],
      toolFailure: '',
      outputSpec: '',
      outputFormat: 'markdown',
      languageTone: '中文，面向管理者，控制在一页内。',
      fields: [],
      fallback: '材料不足以支撑某项结论时，在「待确认」一节列出，不要给出推测值。',
      examples: '',
    }),
  },
]
