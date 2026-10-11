/**
 * 「返回输入框」确认条：二选一 —— 同步已构建提示词，或直接返回。
 *
 * 独立成组件是因为它是唯一会改写输入框草稿的入口，语义值得单独标注：
 * 「同步并返回」先 `setDraft` 再关闭（顺序不可颠倒，见下），「直接返回」不碰草稿。
 */
import type { ReactNode } from 'react'
import { SmallButton } from './base.js'
import {
  COLORS,
  primaryButtonStyle,
  rowStyle,
} from './styles.js'

/** 返回确认条的 props。 */
export interface ReturnPromptBarProps {
  /** 身份与目标是否都已填写（未填写时不能同步）。 */
  canSync: boolean
  /**
   * 同步提示词并关闭。
   *
   * 实现必须先 `setDraft` 再关闭弹窗：shell 的编辑器归会话所有，写入不依赖
   * 输入卡是否挂载，因此顺序无关但语义上「先写再走」更直观。
   */
  onSyncAndClose: () => void
  /** 不同步，直接关闭。 */
  onCloseWithoutSync: () => void
}

/**
 * 返回确认条。
 * @param props - 可用性与两个动作。
 * @returns 确认条元素。
 */
export function ReturnPromptBar({
  canSync, onSyncAndClose, onCloseWithoutSync,
}: ReturnPromptBarProps): ReactNode {
  return (
    <div
      style={{
        ...rowStyle,
        flexWrap: 'wrap',
        padding: '10px 12px',
        border: `1px solid ${COLORS.borderStrong}`,
        borderRadius: 10,
        background: COLORS.subtle,
      }}
    >
      <span style={{ color: COLORS.textSecondary, fontSize: 12 }}>
        返回前是否把已构建的提示词同步到输入框？
      </span>
      <button
        type="button"
        style={{
          ...primaryButtonStyle,
          opacity: canSync ? 1 : 0.5,
          cursor: canSync ? 'pointer' : 'not-allowed',
        }}
        disabled={!canSync}
        title={canSync ? '把提示词写入输入框草稿' : '身份与目标为必填'}
        onClick={onSyncAndClose}
      >
        同步并返回
      </button>
      <SmallButton title="不同步，直接返回" onClick={onCloseWithoutSync}>
        不同步，直接返回
      </SmallButton>
    </div>
  )
}
