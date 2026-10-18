/**
 * 自动填充的一行：一句话需求 + 触发按钮 + 状态说明。
 *
 * 从 `Modal.tsx` 拆出（单文件行数上限），也让弹窗保持"只拼装"的角色。它不碰网络、不碰 store
 * —— 请求由容器（`Panel`）发起。
 */
import type { ReactNode } from 'react'
import type { AssistState } from '../../shared/types.js'
import { SmallButton, TextInput } from '../../../../shared/ui/base.js'
import s from '../../../../shared/ui/panel.module.css'

/** 自动填充行的 props。 */
export interface AssistRowProps {
  /** 自动填充的状态。 */
  assist: AssistState
  /** 改写那句话需求。 */
  onBriefChange: (brief: string) => void
  /** 请宿主跑一次扩写。 */
  onAssist: () => void
}

/**
 * 自动填充行。
 * @param props - 状态与两个回调。
 * @returns 输入行 + 状态说明。
 */
export function AssistRow({ assist, onBriefChange, onAssist }: AssistRowProps): ReactNode {
  const running = assist.status === 'running'
  return (
    <>
      <div className={s.row}>
        <div className={s.grow}>
          <TextInput
            value={assist.brief}
            ariaLabel="一句话需求（自动填充）"
            placeholder="一句话描述要做的事，例如「写一个排查线上告警的提示词」"
            onChange={onBriefChange}
          />
        </div>
        <SmallButton
          title="调用子代理把这句话扩写成表单字段（不进入对话上下文）"
          disabled={running || assist.brief.trim() === ''}
          onClick={onAssist}
        >
          {running ? '生成中…' : '自动填充'}
        </SmallButton>
      </div>
      {assist.error === '' ? null : (
        <p role="status" className={s.dangerCaption}>{assist.error}</p>
      )}
      {assist.warnings.length === 0 ? null : (
        <p role="note" className={s.captionText}>
          {`已填充；宿主丢弃了 ${assist.warnings.length} 处不合法内容：${assist.warnings.join('；')}`}
        </p>
      )}
    </>
  )
}
