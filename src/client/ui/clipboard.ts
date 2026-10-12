/**
 * 剪贴板写入。
 *
 * 优先用异步 `navigator.clipboard`；它在非安全上下文（http 且非 localhost）或
 * 缺少用户手势时会拒绝，因此保留 `document.execCommand('copy')` 这条同步降级路径。
 * 两条都失败才返回 `false`，由调用方给出提示。
 */

/**
 * 把文本写入剪贴板。
 * @param text - 待复制文本。
 * @returns 是否成功写入。
 */
export async function copyText(text: string): Promise<boolean> {
  if (text === '') return false
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // 落到下面的同步降级路径。
    }
  }
  return copyTextFallback(text)
}

/**
 * 同步降级：临时插入一个只读文本域，选中后交给 `execCommand('copy')`。
 * @param text - 待复制文本。
 * @returns 是否成功写入。
 */
function copyTextFallback(text: string): boolean {
  if (typeof document === 'undefined') return false
  const area = document.createElement('textarea')
  area.value = text
  // 移出视口但仍可选中，避免聚焦时页面跳动。
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.opacity = '0'
  document.body.appendChild(area)
  try {
    area.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}
