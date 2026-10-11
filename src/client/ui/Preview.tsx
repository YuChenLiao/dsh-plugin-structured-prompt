/**
 * 提示词预览：把最终成稿摊开，便于发送前确认。
 *
 * 用 `<details>` 而不是自建展开状态 —— 原生元素自带键盘可达性与展开语义，
 * 而这里不需要把展开状态存进 store。
 */
import type { ReactNode } from 'react'
import { COLORS } from './styles.js'

/** 预览区的 props。 */
export interface PreviewProps {
  /** 已构建的提示词。 */
  prompt: string
}

/**
 * 提示词预览。
 * @param props - 已构建的提示词。
 * @returns 可折叠的预览元素。
 */
export function Preview({ prompt }: PreviewProps): ReactNode {
  return (
    <details style={{ fontSize: 12 }}>
      <summary style={{ cursor: 'pointer', color: COLORS.textSecondary }}>
        {`预览已构建的提示词（${prompt.length} 字）`}
      </summary>
      <pre
        style={{
          margin: '8px 0 0',
          maxHeight: 260,
          overflow: 'auto',
          padding: 10,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 8,
          whiteSpace: 'pre-wrap',
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        {prompt === '' ? '（尚未填写身份与目标）' : prompt}
      </pre>
    </details>
  )
}
