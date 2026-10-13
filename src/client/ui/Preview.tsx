/**
 * 提示词预览：把最终成稿摊开，并在折叠标题上给出**预算**（字数 / 估算 token），展开后
 * 列出逐段占用 —— 提示词是要发出去的，用户需要知道它大概会占多少上下文、哪一段最吃。
 *
 * 用 `<details>` 而不是自建展开状态 —— 原生元素自带键盘可达性与展开语义，
 * 而这里不需要把展开状态存进 store。
 *
 * token 是**估算**（见 `shared/tokens.ts` 的说明），只用于判断"是不是太长了"。
 */
import type { ReactNode } from 'react'
import type { PromptSection } from '../../shared/prompt.js'
import { estimateTokens } from '../../shared/tokens.js'
import { COLORS } from './styles.js'

/** 预览区的 props。 */
export interface PreviewProps {
  /** 已构建的提示词。 */
  prompt: string
  /** 分段结果，用于逐段占用。 */
  sections: readonly PromptSection[]
}

/**
 * 提示词预览。
 * @param props - 已构建的提示词与分段结果。
 * @returns 可折叠的预览元素。
 */
export function Preview({ prompt, sections }: PreviewProps): ReactNode {
  const total = estimateTokens(prompt)
  const title = prompt === ''
    ? '预览已构建的提示词'
    : `预览已构建的提示词（${prompt.length} 字 · 约 ${total} tokens）`
  return (
    <details style={{ fontSize: 12 }}>
      <summary style={{ cursor: 'pointer', color: COLORS.textSecondary }}>{title}</summary>
      {sections.length === 0 ? null : (
        <ul
          style={{
            margin: '8px 0 0',
            padding: '0 0 0 16px',
            color: COLORS.textSecondary,
            lineHeight: 1.7,
          }}
        >
          {sections.map((section) => {
            const tokens = estimateTokens(section.body)
            const percent = total === 0 ? 0 : Math.round((tokens / total) * 100)
            return (
              <li key={section.title}>
                {`${section.title}：${tokens} tokens（${percent}%）`}
              </li>
            )
          })}
        </ul>
      )}
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
