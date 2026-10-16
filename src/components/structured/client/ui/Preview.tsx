/**
 * 提示词预览：把最终成稿摊开，并在折叠标题上给出**预算**（字数 / 估算 token），展开后
 * 列出逐段占用 —— 提示词是要发出去的，用户需要知道它大概会占多少上下文、哪一段最吃。
 *
 * 用 `<details>` 而不是自建展开状态 —— 原生元素自带键盘可达性与展开语义，
 * 而这里不需要把展开状态存进 store。
 *
 * token 是**估算**（见 `shared/tokens.ts` 的说明），只用于判断"是不是太长了"。
 *
 * 样式在 CSS Modules 里（`shared/ui/panel.module.css`）。
 */
import type { ReactNode } from 'react'
import type { PromptSection } from '../../shared/prompt.js'
import { estimateTokens } from '../../shared/tokens.js'
import s from '../../../../shared/ui/panel.module.css'

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
    <details className={s.previewDetails}>
      <summary className={s.previewSummary}>{title}</summary>
      {sections.length === 0 ? null : (
        <ul className={s.previewList}>
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
      <pre className={s.previewPre}>
        {prompt === '' ? '（尚未填写身份与目标）' : prompt}
      </pre>
    </details>
  )
}
