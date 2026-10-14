/**
 * 内置模板库：填充的是**表单字段**，不是成稿提示词。
 *
 * 数据在 `templates.json` —— **单一真源**：客户端表单的模板下拉、host 工具的 `template`
 * 枚举、以及黄金样本都从它来。改一套模板只动 JSON，不必碰代码，也就没有"两份清单各自漂移"
 * 的机会。第一套 `alert-triage` 是本插件最初的那份示例（用来验证生成结果与原始实现一致）。
 *
 * 两个半边都把它打包进自己的产物：打包器会把 JSON 内联成字面量（实测 host / client 产物都
 * 没有外部引用），因此 host 半边「零 import」的约束不受影响。
 *
 * JSON 是**文件边界**：这里按 `forms.ts` 的字段形状校验一次，形状不对就抛错，而不是把坏值
 * 塞进表单。校验与导入 JSON 文档共用同一份 `FIELD_SHAPES`。
 */
import { FIELD_SHAPES, completeForm, matchesShape } from './forms.js'
import type { PromptForm, PromptTemplate } from './types.js'
import raw from './templates.json'

/** JSON 里一条模板记录的原始形状。 */
interface RawTemplate {
  readonly id: string
  readonly label: string
  readonly whenToUse: string
  readonly fields: Record<string, unknown>
}

/**
 * 把 JSON 片段收窄成表单片段。
 *
 * 模板是仓库自己的数据，写错就该立刻炸：未知字段、类型不符、越界枚举都在这里拦下。
 * @param fields - JSON 里的字段片段。
 * @param id - 模板 id（只用于错误信息）。
 * @returns 通过校验的表单片段。
 * @throws {Error} 字段名或取值不符合 `PromptForm` 的形状时。
 */
function toTemplateFields(fields: Record<string, unknown>, id: string): Partial<PromptForm> {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    const shape = (FIELD_SHAPES as Record<string, string | undefined>)[key]
    if (shape === undefined) throw new Error(`template "${id}": unknown form field "${key}"`)
    if (!matchesShape(value, shape)) {
      throw new Error(`template "${id}": field "${key}" is not ${shape}`)
    }
    patch[key] = value
  }
  return patch as Partial<PromptForm>
}

const RAW = raw as { readonly templates: readonly RawTemplate[] }

/**
 * 内置模板库。
 *
 * `build()` 把字段片段补全成完整表单（缺省项为空），交给 store 的 `setForm`。
 */
export const TEMPLATES: readonly PromptTemplate[] = RAW.templates.map(entry => ({
  id: entry.id,
  label: entry.label,
  whenToUse: entry.whenToUse,
  build: () => completeForm(toTemplateFields(entry.fields, entry.id)),
}))
