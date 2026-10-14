/**
 * 工具参数的处理：收窄、默认值回退、以及工具名/用途的配对拆分。
 *
 * 从 `tool.ts` 拆出，让那个文件只留「定义 / 执行 / 卡片」（表单映射在 `build.ts`）。
 *
 * 这里承担了 registry 之外的类型检查：本插件刻意不 import 宿主包（理由见
 * `parameters.ts`），因此不能借 `defineTool` 做参数校验，逐字段检查由 `narrowArgs`
 * 代劳。不合规就**报错**而不是静默丢弃 —— 失败说明会回到模型手里，它能据此改正。
 */
import { OUTPUT_FORMAT_SKELETONS } from '../shared/format.js'
import { TEMPLATES } from '../shared/templates.js'

/** 需要按「字符串数组」读取的字段名。 */
export const ARRAY_FIELDS = ['rules', 'forbidden', 'callable_tools', 'tool_guidance', 'fields'] as const

/** 需要按「字符串」读取的非必填字段名。 */
export const STRING_FIELDS = [
  'template', 'background', 'success_criteria', 'tool_policy', 'tool_failure',
  'output_format', 'output_spec', 'language_tone', 'fallback', 'examples',
] as const

/**
 * 需要按枚举校验的字段。
 *
 * 越界值不会报错，只会让下游**静默降级**（例如骨架查不到，输出格式段少一段），因此
 * 在参数边界就拒绝：这个来源是模型，而模型能读懂错误信息并改正。
 */
const ENUM_FIELDS: Record<string, readonly string[]> = {
  output_format: Object.keys(OUTPUT_FORMAT_SKELETONS),
  tool_policy: ['auto', 'manual'],
  // 模板 id 也走枚举校验：未知 id 会被静默当成"没传模板"，产出一份短得多的提示词，
  // 而调用方与用户都看不出模板内容已经全丢。
  template: TEMPLATES.map(template => template.id),
}

/** 模型传入的参数（键全部可选；`role` / `goal` 通常必填，传了 `template` 时可省，见 `narrowArgs`）。 */
export interface ToolArgs extends Record<string, unknown> {
  role?: unknown
  goal?: unknown
}

/** 委托参数（`delegate`）：把构建好的提示词直接交给子代理执行，而不是返回给调用方。 */
export interface DelegateArgs {
  /** 子代理任务的短标签。 */
  readonly label?: string
  /** 指定的 provider 名；通常省略（默认走一次性运行的 provider）。 */
  readonly provider?: string
}

/**
 * 收窄后的参数。
 *
 * 用接口而不是交叉类型：`delegate` 是对象，与「其余字段都是字符串或字符串数组」的索引
 * 签名不能共存于交叉类型里，写成一个接口才能同时表达两者。
 */
export interface NarrowedArgs {
  /**
   * 身份（已 trim）。
   *
   * 可缺省：`template` 会带上它（`buildFromArgs` 里 role/goal 走 `prefer(调用参数, 模板底座)`）。
   */
  role?: string
  /** 目标（已 trim）；与 `role` 同理可由模板提供。 */
  goal?: string
  /** 委托参数；未要求委托时缺省。 */
  delegate?: DelegateArgs
  /** 其余表单字段按需存在（构建时逐项写入，故这里不能声明为只读）。 */
  [field: string]: string | string[] | DelegateArgs | undefined
}

/**
 * 把模型传入的参数收窄成可用形状。
 * @param raw - 模型传入的参数。
 * @returns 收窄后的参数。
 * @throws {Error} 字段类型不符、枚举越界，或"未指模板且缺 role/goal"时。
 */
export function narrowArgs(raw: unknown): NarrowedArgs {
  if (typeof raw !== 'object' || raw === null) throw new Error('arguments must be an object')
  const args = raw as ToolArgs
  const problems: string[] = []

  // 身份与目标：通常必填，但**模板可以带**（构建时它们走 `prefer(调用参数, 模板底座)`）。
  // 所以只有"既没指模板、又没给"时才报错 —— 否则"只填任务特有的字段、其余交给模板"这条路径
  // 会被边界拦住，而模板存在的意义恰恰是少填字段。
  //
  // 这不是放松约束，而是把约束挪到能给出路的地方：实测模型 10 次调用里有 2 次因为漏传 `role`
  // 直接失败，而它当时给出的其余字段都是对的 —— 一次白跑换来的是它放弃继续用这个工具。
  // 类型错误照旧必报；只有"缺失或空白"才看模板在不在场。
  const usesTemplate = typeof args['template'] === 'string' && args['template'].trim() !== ''
  for (const field of ['role', 'goal'] as const) {
    const value = args[field]
    if (value !== undefined && typeof value !== 'string') {
      problems.push(`${field} must be a string`)
      continue
    }
    if (typeof value === 'string' && value.trim() !== '') continue
    if (usesTemplate) continue
    problems.push(
      `${field} is required and must be a non-empty string `
      + '(or pass `template`: every built-in template carries a role and a goal)',
    )
  }
  for (const field of STRING_FIELDS) {
    const value = args[field]
    if (value !== undefined && typeof value !== 'string') problems.push(`${field} must be a string`)
  }
  for (const field of ARRAY_FIELDS) {
    const value = args[field]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      problems.push(`${field} must be an array of strings`)
    }
  }
  // 枚举校验：越界值必须报错，不能让它带着 schema 外的取值进入构建流程。
  //
  // 空串按「未给」跳过，与 `prefer` 的约定一致 —— 否则模型用空串表达"不指定格式"时
  // 会白白失败一次，而其它字符串字段的空串都是合法的。
  for (const [field, allowed] of Object.entries(ENUM_FIELDS)) {
    const value = args[field]
    if (value === undefined) continue
    if (typeof value === 'string' && value.trim() === '') continue
    if (typeof value !== 'string' || !allowed.includes(value)) {
      problems.push(`${field} must be one of: ${allowed.join(', ')}`)
    }
  }
  // 委托参数：形状固定，只认声明的两个子字段（未知键在这里报错，而不是被静默忽略）。
  const rawDelegate = args['delegate']
  let delegate: DelegateArgs | undefined
  if (rawDelegate !== undefined) {
    if (typeof rawDelegate !== 'object' || rawDelegate === null || Array.isArray(rawDelegate)) {
      problems.push('delegate must be an object')
    } else {
      const record = rawDelegate as Record<string, unknown>
      for (const [key, value] of Object.entries(record)) {
        if (key !== 'label' && key !== 'provider') {
          problems.push(`delegate.${key} is not a supported field`)
        } else if (typeof value !== 'string') {
          problems.push(`delegate.${key} must be a string`)
        }
      }
      const label = record['label']
      const provider = record['provider']
      delegate = {
        ...(typeof label === 'string' ? { label } : {}),
        ...(typeof provider === 'string' ? { provider } : {}),
      }
    }
  }
  if (problems.length > 0) throw new Error(`invalid arguments: ${problems.join('; ')}`)

  // role/goal 只在确实给出非空串时写入：缺省时留给 `prefer` 去回退模板底座，
  // 不能在这里写成空串（那会把"未给"变成"给了个空串"）。
  const narrowed: NarrowedArgs = {}
  for (const field of ['role', 'goal'] as const) {
    const value = args[field]
    if (typeof value === 'string' && value.trim() !== '') narrowed[field] = value.trim()
  }
  if (delegate !== undefined) narrowed['delegate'] = delegate
  for (const field of STRING_FIELDS) {
    const value = args[field]
    if (typeof value === 'string') narrowed[field] = value
  }
  for (const field of ARRAY_FIELDS) {
    const value = args[field]
    if (Array.isArray(value)) narrowed[field] = value as string[]
  }
  return narrowed
}

/**
 * 取「调用参数优先，未给则用模板默认值」的值。
 *
 * 空串（含纯空白）、空数组、以及**全由空白条目组成的数组**都算「未给」：模板填了 3 条
 * 硬性规则时，模型传 `rules: []` 或 `rules: ['']` 的意图几乎总是"没额外要求"，而不是
 * "把模板的规则删掉"。整组判定而不是逐条过滤 —— 逐条过滤会丢掉空串、让工具名与用途的
 * 索引错位（那些空工具名行的忽略发生在下游，按原始索引处理）。
 * @param provided - 模型传入的值。
 * @param fallback - 模板/空白表单的默认值。
 * @returns 生效的值。
 */
export function prefer<T>(provided: T | undefined, fallback: T): T {
  if (provided === undefined) return fallback
  // 字符串侧与数组侧共用同一个「空白」定义：将来改判空规则只需要动 `isBlankItem`。
  if (isBlankItem(provided)) return fallback
  if (Array.isArray(provided) && provided.every(isBlankItem)) return fallback
  return provided
}

/**
 * 数组条目算不算「空白」。
 *
 * 非字符串条目按非空白处理：`prefer` 只负责判断"给没给"，条目怎么处理是下游的事。
 * @param item - 数组条目。
 * @returns 字符串且 trim 后为空时为 `true`。
 */
function isBlankItem(item: unknown): boolean {
  return typeof item === 'string' && item.trim() === ''
}

/**
 * 一批调用参数条目算不算「给了」。
 *
 * 与 `prefer` 共用 {@link isBlankItem}：空数组与全空白条目都算「未给」。导出它是为了让
 * 必须**整组同进同退**的字段（工具名与用途）复用同一条规则 —— 各自判定会让两个数组
 * 错位，例如 `[': 用途']` 的工具名为空而用途非空。
 * @param items - 调用参数里的字符串数组。
 * @returns 至少有一个非空白条目时为 `true`。
 */
export function isProvidedList(items: readonly string[] | undefined): boolean {
  return items !== undefined && !items.every(isBlankItem)
}

/**
 * 把「工具名」或「工具名：用途」形式的条目拆成两个按索引配对的数组。
 *
 * 表单侧是工具名与用途两个数组配对编辑；工具参数为了简洁只收一个字符串数组，
 * 因此在这里按全角/半角冒号拆一次。
 * @param entries - 模型传入的条目。
 * @returns 工具名数组与用途数组（长度对齐）。
 */
export function splitCallableTools(entries: readonly string[]): { tools: string[]; slots: string[] } {
  const tools: string[] = []
  const slots: string[] = []
  for (const entry of entries) {
    // 第一组允许为空：条目以冒号开头时得到空工具名，该行随后与其它空工具名行一样被
    // 整体忽略 —— 否则「:用途」会被当成一个名叫「:用途」的工具写进提示词。
    const matched = /^([^：:]*)[：:](.*)$/.exec(entry)
    if (matched === null) {
      tools.push(entry.trim())
      slots.push('')
    } else {
      tools.push((matched[1] ?? '').trim())
      slots.push((matched[2] ?? '').trim())
    }
  }
  return { tools, slots }
}

