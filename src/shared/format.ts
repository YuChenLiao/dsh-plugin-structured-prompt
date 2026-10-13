/**
 * 输出格式的语义：骨架表、骨架解析、按格式类型更新说明、以及说明与格式类型的关系。
 *
 * 从 `prompt.ts` 拆出：这一组规则互相依赖且自成一体（都围绕"骨架"这一概念），而
 * `prompt.ts` 已经接近单文件行数上限。调用方仍可以继续从 `prompt.js` 取
 * `OUTPUT_FORMAT_SKELETONS`（那里做了再导出），但新代码直接 import 本模块更清楚。
 */
import type { OutputFormat } from './types.js'

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

/**
 * 取某个格式类型的骨架。
 *
 * 用 `Object.hasOwn` 查表而不是直接下标取值：越界的格式类型（模型传了 schema 外的值、
 * 或旧表单里的历史值）下标取值会得到 `undefined`，被后续 `join` 折叠成空串，于是整个
 * 输出格式段静默少一段。查不到就明确返回空串，并由调用方决定是否拒绝该输入。
 * @param format - 格式类型。
 * @returns 骨架文本；空串或越界值返回空串。
 */
export function resolveSkeleton(format: OutputFormat): string {
  if (!Object.hasOwn(OUTPUT_FORMAT_SKELETONS, format)) return ''
  return OUTPUT_FORMAT_SKELETONS[format as Exclude<OutputFormat, ''>]
}

/**
 * 「输出格式说明」与所选格式类型的关系。
 *
 * - `empty`：说明为空 —— 格式类型将生成骨架；
 * - `matches`：说明就是当前格式的骨架；
 * - `extends`：说明 = 当前格式骨架 + 追加内容；
 * - `detached`：说明与所选格式无关 —— **格式类型不生效**，说明才是最终契约。
 */
export type FormatSpecStatus = 'empty' | 'matches' | 'extends' | 'detached'

/**
 * 判断格式说明与格式类型的关系。
 *
 * 存在的意义是让界面能说出"格式类型已经被说明覆盖了"。没有这个提示时，用户改选格式
 * 类型后看到的是一段与选择不符的契约，而界面仍然高亮着新值 —— 两边静默分叉
 * （`applyFormatChoice` 只负责在切换时同步骨架，管不到"用户手写后再改选"的语义）。
 * @param spec - 格式说明。
 * @param format - 所选格式类型。
 * @returns 关系状态。
 */
export function formatSpecStatus(spec: string, format: OutputFormat): FormatSpecStatus {
  const trimmed = spec.trim()
  if (trimmed === '') return 'empty'
  const skeleton = resolveSkeleton(format)
  // 没选格式（或越界值）：说明自成一格，不算"覆盖了格式类型"。
  if (skeleton === '') return 'detached'
  if (trimmed === skeleton) return 'matches'
  if (trimmed.startsWith(skeleton)) return 'extends'
  return 'detached'
}

/**
 * 按新选的格式类型更新「输出格式说明」。
 *
 * 客户端选格式时会把骨架写进说明字段供用户接着编辑，因此说明可能处于三种状态：
 *  - 空、或恰好是某套骨架：整段替换；
 *  - 在某套骨架基础上追加过内容：**只替换骨架部分**，保留追加的内容；
 *  - 完全手写：不动 —— 说明才是最终契约，此时格式类型不再影响产物。
 *
 * 中间那条是关键：早先"已被手写就完全不覆盖"的规则会让用户改选格式后，产物里仍是
 * 旧格式的契约（格式类型在 UI 上已高亮为新值），两边静默分叉。
 * @param current - 当前的格式说明。
 * @param format - 新选的格式类型；空串表示清除选择。
 * @returns 更新后的格式说明。
 */
export function applyFormatChoice(current: string, format: OutputFormat): string {
  const skeleton = resolveSkeleton(format)
  if (skeleton === '') return current
  // 比较前统一归一：说明可能带首尾空白，用原值比较会让"仍是某套骨架"命中不了 ——
  // 于是改选格式后说明留在旧格式上，而 formatSpecStatus 又按 trim 判定成 detached，
  // 界面把"替换逻辑自己没命中"误报成"用户手写了契约"。
  const trimmed = current.trim()
  const known: string[] = Object.values(OUTPUT_FORMAT_SKELETONS)
  if (trimmed === '' || known.includes(trimmed)) return skeleton
  const previous = known.find(item => trimmed.startsWith(item))
  return previous === undefined ? current : skeleton + trimmed.slice(previous.length)
}
