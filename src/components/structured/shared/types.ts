/**
 * 结构化提示词组件的共享类型：表单字段与组件状态。
 *
 * 全部为纯类型，无运行时导出（因此用 `.ts` 而非 `.d.ts`，可被 `import type` 消费
 * 而不产生运行时代码）。提示词库的类型在 `components/library/shared/library.ts`。
 */

/** 工具调用策略。 */
export type ToolPolicy = '' | 'auto' | 'manual'

/** 输出格式类型：决定 `outputSpec` 的初始骨架。 */
export type OutputFormat = '' | 'json' | 'markdown' | 'table' | 'text'

/**
 * 表单里所有「字符串数组」字段名。
 *
 * `setItem` / `addItem` / `removeItem` / `moveItem` 共用这一个键集合：凡是字符串
 * 数组都能被逐条编辑，工具名的两个数组也因此能复用同一套增删改序。
 */
export type ListFieldKey = 'rules' | 'forbidden' | 'toolGuidance' | 'fields' | 'callableTools' | 'toolSlots'

/**
 * 分组内以逐条编辑器呈现的字段。
 *
 * 是 {@link ListFieldKey} 的真子集 —— 工具名的两个数组由专用的配对编辑器处理
 * （它们必须成对增删），不走通用列表编辑器。
 */
export type EditorFieldKey = 'rules' | 'forbidden' | 'toolGuidance' | 'fields'

/** 结构化提示词的全部表单字段。 */
export interface PromptForm {
  /** 身份（必填）。 */
  role: string
  /** 目标（必填）。 */
  goal: string
  /** 背景与上下文（并入身份段）。 */
  background: string
  /** 成功标准（并入目标段）。 */
  successCriteria: string
  /** 硬性规则（逐条编号）。 */
  rules: string[]
  /** 禁止行为（并入硬性规则段的子块）。 */
  forbidden: string[]
  /** 调用工具策略。 */
  toolPolicy: ToolPolicy
  /**
   * 手动策略下由用户直接填写的可调用工具名。
   *
   * 与 {@link PromptForm.toolSlots} **按索引配对**：用途可留空，工具名留空的行
   * 整体忽略。刻意不提供"从已安装清单里勾选"—— 见 README 的设计说明。
   */
  callableTools: string[]
  /** 与 `callableTools` 索引对齐的用途说明（可含空串）。 */
  toolSlots: string[]
  /** 工具使用策略（逐条）。 */
  toolGuidance: string[]
  /** 工具失败时的处理（并入工具使用策略段）。 */
  toolFailure: string
  /** 输出格式说明。 */
  outputSpec: string
  /** 输出格式类型。 */
  outputFormat: OutputFormat
  /** 语言与语气（并入输出格式段）。 */
  languageTone: string
  /** 字段级说明（并入输出格式段）。 */
  fields: string[]
  /** 数据不足时的行为。 */
  fallback: string
  /** 少样本示例。 */
  examples: string
}

/** 一个会话的结构化输入状态。 */
export interface StructuredState {
  /** 是否已打开表单弹窗。 */
  active: boolean
  /** 表单字段。 */
  form: PromptForm
  /** 已折叠的分组 id；基础信息永不出现于此。 */
  collapsed: string[]
  /**
   * 当前表单套用了哪套模板（模板 id）；空串表示不是模板套用状态。
   *
   * 它只驱动界面上的场景条，**不参与提示词构建**：表单字段本身才是产物来源，所以这里
   * 记错也只会让提示条说错话，不会改变成稿。放在 store 而不是组件本地状态，是因为
   * 渲染测试只能驱动 store，本地状态在 SSR 下不可观测（等于没有守护）。
   */
  appliedTemplate: string
}

/** 四个分组的元数据。 */
export interface SectionMeta {
  readonly id: string
  readonly title: string
  /** 是否可折叠；基础信息为 `false`（常开）。 */
  readonly collapsible: boolean
}

/** 一个可逐条编辑的数组字段的展示元数据。 */
export interface ListFieldMeta {
  readonly key: EditorFieldKey
  readonly label: string
  readonly placeholder: string
}

/** 内置模板：填充的是表单字段，不是成稿提示词。 */
export interface PromptTemplate {
  readonly id: string
  readonly label: string
  /**
   * 一句话场景：模型据此挑选模板，也是工具 schema 里 `template` 取值的说明。
   *
   * 模板库省的从来不只是字段数：把「约束 + 输出 + 兜底」这类结构与任务形态绑定，模型只需给
   * `role`/`goal` 与少量覆盖，产物反而更完整。代价是每句说明都**常驻**工具 schema（每步都在
   * 上下文里），所以它必须短。
   */
  readonly whenToUse: string
  /** 返回**完整**表单（未填项由模板自己给空值），交给 store 的 `setForm`。 */
  build(): PromptForm
}
