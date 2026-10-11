/**
 * 表单的结构元数据：分组与逐条编辑字段。
 *
 * 放在独立模块是为了让「表单长什么样」与「提示词怎么生成」各自有唯一归属：
 * 新增字段时这里加元数据、`prompt.ts` 加段落映射。
 */
import type { ListFieldMeta, SectionMeta } from '../types.js'

/**
 * 四个分组。基础信息常开，其余三组默认折叠但可展开。
 *
 * `id` 同时是折叠状态的键，必须与 store 初始 `collapsed` 里的取值一致。
 */
export const SECTIONS: readonly SectionMeta[] = [
  { id: 'basic', title: '基础信息', collapsible: false },
  { id: 'rules', title: '约束与规则', collapsible: true },
  { id: 'tools', title: '工具策略', collapsible: true },
  { id: 'output', title: '输出与兜底', collapsible: true },
]

/** 逐条编辑的数组字段。 */
export const LIST_FIELDS: Record<string, ListFieldMeta> = {
  rules: {
    key: 'rules',
    label: '硬性规则（每行一条，会按 1. 2. 3. 编号）',
    placeholder: '例如：所有数值必须带上单位和时间窗口',
  },
  forbidden: {
    key: 'forbidden',
    label: '禁止行为（每行一条）',
    placeholder: '例如：不得输出猜测性的根因结论',
  },
  toolGuidance: {
    key: 'toolGuidance',
    label: '工具使用策略（每行一条）',
    placeholder: '例如：先调用 query_metrics 拿指标，再调用 get_threshold_config 拿阈值',
  },
  fields: {
    key: 'fields',
    label: '字段级说明（每行一条）',
    placeholder: '例如：severity: "P0" | "P1" | "P2" | "info"',
  },
}

/** 输出格式类型的 chip 选项。 */
export const OUTPUT_FORMAT_OPTIONS: readonly (readonly [string, string])[] = [
  ['', '未指定'],
  ['json', 'JSON'],
  ['markdown', 'Markdown'],
  ['table', '表格'],
  ['text', '纯文本'],
]

/** 工具调用策略的 chip 选项。 */
export const TOOL_POLICY_OPTIONS: readonly (readonly [string, string])[] = [
  ['auto', '自动（交给模型自行判断）'],
  ['manual', '手动（指定要调用的工具）'],
  ['', '不指定'],
]
