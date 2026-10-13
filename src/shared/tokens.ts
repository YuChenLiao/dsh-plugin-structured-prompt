/**
 * token 的粗略估算。
 *
 * 刻意不引入分词器：那会带来依赖与体积，而不同模型的分词器也各不相同 —— 提示词构建器
 * 需要的只是"这段大概多长，会不会挤占上下文"，不是精确计费。
 *
 * 估算规则：CJK 字符（含全角标点）每字 1 token，其余字符每 4 字符 1 token。对以中文
 * 为主的提示词，误差通常在两成以内。
 */

/**
 * 判断是否为 CJK 字符（含全角标点与全角形式）。
 * @param code - 码点。
 * @returns 是否按"每字 1 token"计。
 */
function isCjk(code: number): boolean {
  return (code >= 0x3000 && code <= 0x303f) // CJK 标点
    || (code >= 0x3400 && code <= 0x4dbf) // 扩展 A
    || (code >= 0x4e00 && code <= 0x9fff) // 基本区
    || (code >= 0xf900 && code <= 0xfaff) // 兼容表意文字
    || (code >= 0xff00 && code <= 0xffef) // 全角形式
}

/**
 * 估算文本的 token 数。
 * @param text - 待估算的文本。
 * @returns 估算值（`estimateTokens('') === 0`）。
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let rest = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (isCjk(code)) cjk += 1
    else rest += 1
  }
  return cjk + Math.ceil(rest / 4)
}
