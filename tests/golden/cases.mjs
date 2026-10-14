/**
 * 黄金文件用例集：提示词格式的**契约样本**。
 *
 * 每个用例的期望产物存在同目录的 `<id>.txt`（人工核对后入库），由
 * `tests/test-golden.mjs` 逐字比对。用途是锁住"提示词长什么样"这件事 ——
 * 格式一变，用户已保存的表单、已导出的 JSON、以及已交给子代理的提示词都会漂移，
 * 而手写断言只覆盖想得到的场景（上一轮的格式分叉就是这样漏掉的）。
 *
 * 用例形状：
 *   { id, note }                        —— 走**表单**路径（默认）
 *   { id, note, template?, patch? }      —— 走表单路径，template 作基底、patch 覆盖
 *   { id, note, via: 'tool', args }      —— 走**工具**路径（host 侧 buildFromArgs）
 *
 * 两条路径都要有样本：只覆盖表单路径的话，host 侧的映射逻辑改动不会被任何契约样本
 * 挡住（这正是复审指出的缺口）。
 *
 * 新增用例：在这里加一条，然后 `node tests/test-golden.mjs --update` 生成期望文件，
 * **打开生成的文件核对一遍**再提交。
 */

/**
 * @type {ReadonlyArray<{
 *   id: string,
 *   note: string,
 *   template?: string,
 *   patch?: Record<string, unknown>,
 *   via?: 'tool',
 *   args?: Record<string, unknown>,
 * }>}
 */
export const CASES = [
  {
    id: 'minimal',
    note: '只填两个必填项：只应出现身份与目标两段',
    patch: { role: '一名严谨的工程师', goal: '把这次改动写成一段说明。' },
  },
  {
    id: 'full',
    note: '17 项全填：所有顶层段都出现，扩写字段并入既有段而非新增段',
    patch: {
      role: '你是一名负责线上稳定性的 SRE 助手',
      goal: '根据监控数据判断告警是否需要人工立即介入。',
      background: '服务于一个日订单量百万级的电商系统。',
      successCriteria: '每条结论都能指向具体的指标与时间窗口。',
      rules: ['只能基于工具返回的数据下结论', '所有数值必须带上单位和时间窗口'],
      forbidden: ['不得引用记忆中其他系统的经验值'],
      toolPolicy: 'manual',
      callableTools: ['query_metrics', 'read_config'],
      toolSlots: ['拉取指标', ''],
      toolGuidance: ['先查配置再下判断'],
      // 注意不要自己再写「工具失败时」前缀 —— 构建器会统一加，字段标签也已经写明语义。
      toolFailure: '说明失败原因，不要用默认值代替。',
      outputFormat: 'table',
      outputSpec: '',
      languageTone: '简洁直接，中文。',
      fields: ['指标: string', '结论: string'],
      fallback: '若关键指标缺失，明确说明缺失项。',
      examples: '输入 A → 输出 B',
    },
  },
  {
    id: 'template-alert-triage',
    note: '内置模板：告警研判（原始示例，格式不得漂移）',
    template: 'alert-triage',
  },
  {
    id: 'template-code-review',
    note: '内置模板：代码审查',
    template: 'code-review',
  },
  {
    id: 'template-data-extract',
    note: '内置模板：数据抽取',
    template: 'data-extract',
  },
  {
    id: 'template-report',
    note: '内置模板：报告',
    template: 'report',
  },
  {
    id: 'template-override',
    note: '模板作基底 + 覆盖：只该被覆盖的字段变，其余保留模板值',
    template: 'code-review',
    patch: { role: '一名临时审计员', goal: '只检查依赖变更。' },
  },
  {
    id: 'manual-tools-no-purpose',
    note: '手动策略且不给用途：只写工具名，不出现冒号',
    patch: {
      role: '运维工程师',
      goal: '重启服务。',
      toolPolicy: 'manual',
      callableTools: ['restart_service'],
      toolSlots: [''],
    },
  },
  {
    id: 'manual-tools-with-empty-row',
    note: '手动策略含空行：空工具名的行整体忽略，且不破坏其余行的配对',
    patch: {
      role: '运维工程师',
      goal: '重启服务。',
      toolPolicy: 'manual',
      callableTools: ['restart_service', '', 'read_log'],
      toolSlots: ['重启', '不该出现', '读日志'],
    },
  },
  {
    id: 'format-custom-spec',
    note: '格式类型 + 手写说明：说明优先，骨架不得重复出现',
    patch: {
      role: '分析员',
      goal: '汇总数据。',
      outputFormat: 'json',
      outputSpec: '以 TOML 输出，键为 summary 与 findings。',
    },
  },
  {
    id: 'format-skeleton-only',
    note: '只选格式类型：骨架必须出现且只出现一次',
    patch: { role: '分析员', goal: '汇总数据。', outputFormat: 'markdown' },
  },
  {
    id: 'whitespace-only',
    note: '全空白字段：视同未填，不得产出空段或残留空白',
    patch: {
      role: '  审计员  ',
      goal: '检查配置。',
      rules: ['  ', ''],
      forbidden: ['   '],
      toolPolicy: 'auto',
      fallback: '   ',
    },
  },
  // 以下走**工具**路径（host 侧 buildFromArgs），锁住那条路径的映射语义。
  {
    id: 'tool-minimal',
    note: '工具路径：只填两个必填项',
    via: 'tool',
    args: { role: '一名严谨的工程师', goal: '把这次改动写成一段说明。' },
  },
  {
    id: 'tool-template-other-format',
    note: '工具路径：模板 + 指定另一套格式（说明为空时按所选格式生成骨架）',
    via: 'tool',
    args: { role: '分析员', goal: '汇总数据。', template: 'report', output_format: 'json' },
  },
  {
    id: 'tool-manual-tools',
    note: '工具路径：手动策略 + 工具名与用途拆分',
    via: 'tool',
    args: {
      role: '运维工程师',
      goal: '重启服务。',
      tool_policy: 'manual',
      callable_tools: ['restart_service: 重启', '', 'read_log'],
    },
  },
  {
    id: 'tool-explicit-spec-wins',
    note: '工具路径：显式给了格式说明时以它为准，格式类型不得改写它',
    via: 'tool',
    args: {
      role: '分析员',
      goal: '汇总数据。',
      output_format: 'markdown',
      output_spec: '以 TOML 输出，键为 summary。',
    },
  },
  {
    id: 'tool-blank-rules-fall-back',
    note: '工具路径：全空白的 rules 算「未给」，模板的规则不被清掉（与 rules: [] 同一条规则）',
    via: 'tool',
    args: { role: '审计员', goal: '只检查依赖变更。', template: 'code-review', rules: [''] },
  },
  {
    id: 'tool-blank-list-falls-back',
    note: '工具路径：全空白的工具清单算「未给」（整组回退底座，且不产出空转的策略行）',
    via: 'tool',
    args: {
      role: '分析员',
      goal: '汇总数据。',
      template: 'report',
      tool_policy: 'manual',
      callable_tools: [''],
    },
  },
]
