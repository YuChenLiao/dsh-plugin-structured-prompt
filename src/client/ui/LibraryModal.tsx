/**
 * 提示词库检索弹窗（`conversation.input.dock` 的第二个视图）。
 *
 * 与表单弹窗**互斥**，且与构建器完全隔离：检索到的是别人的成品提示词 —— 不做字段校验、
 * 不填进表单。这里只做三件事：检索、预览、发送（或复制）。列表视图在 `LibraryList.tsx`，
 * 拆开是为了单文件行数上限；本文件留弹窗外壳、详情视图与请求副作用。
 *
 * 请求打的是宿主注册的两条**同源**路由（上游没有 CORS 头，浏览器直连会被拒），所以本组件
 * 只认识路径，不认识上游地址 —— 界面文案因此也**不写死上游域名**（`config.libraryBaseUrl`
 * 可以指向自托管实例）。发送走与表单成稿**同一条**链路（宿主的 `onSend`）。
 */
import { useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { LibraryState } from '../../shared/library.js'
import type { FormActions } from './actions.js'
import { SmallButton } from './base.js'
import { copyText } from './clipboard.js'
import { fetchLibraryDetail, searchLibrary, searchPatch } from '../library.js'
import { LibraryList } from './LibraryList.js'
import {
  COLORS,
  maskStyle,
  modalBodyStyle,
  modalFootStyle,
  modalHeadStyle,
  modalStyle,
  primaryButtonStyle,
  rowStyle,
} from './styles.js'

/** 次要说明文字。 */
const captionStyle: CSSProperties = { margin: 0, fontSize: 12, color: COLORS.caption }

/** 原文预览：按内容换行、可横向滚动（原文里可能有长行与表格）。 */
const contentStyle: CSSProperties = {
  margin: 0,
  padding: '10px 12px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowX: 'auto',
}

/** 检索弹窗的 props。 */
export interface LibraryModalProps {
  /** 检索弹窗状态。 */
  library: LibraryState
  /** store 动作。 */
  actions: FormActions
  /** 关闭弹窗。 */
  onClose: () => void
  /** 把选中的提示词作为一条用户消息投递进当前会话。 */
  onSend: (text: string) => void
}

/**
 * 提示词库弹窗。
 * @param props - 状态、动作与回调。
 * @returns 弹窗元素。
 */
export function LibraryModal({
  library, actions, onClose, onSend,
}: LibraryModalProps): ReactNode {
  const [copied, setCopied] = useState(false)
  // 请求序号：只有最后一次发起的请求能写状态。没有这个比对时，快速连续检索、或"先点 A 再点
  // B"会让慢的那个响应覆盖新状态（详情与所选条目错位）。
  const searchSeq = useRef(0)
  const detailSeq = useRef(0)
  const detail = library.detail
  const inDetail = library.selectedId !== ''

  /** 检索：状态先落到 store（界面据此显示"检索中"），结果或失败再落一次。 */
  const runSearch = (): void => {
    searchSeq.current += 1
    const seq = searchSeq.current
    actions.patchLibrary({
      status: 'searching', failure: '', items: [], total: 0,
      selectedId: '', detail: null, detailStatus: 'idle',
    })
    void searchLibrary(library.query).then((result) => {
      if (seq !== searchSeq.current) return
      if (result.ok) {
        // 用 `searchPatch` 而不是在这里逐字段挑：跨半边的这一步（响应 → store）因此有断言守着。
        actions.patchLibrary(searchPatch(result.value))
      } else {
        // 失败时把来源名一并清掉 —— 底部不该继续显示上一次成功时的来源。
        actions.patchLibrary({
          status: 'failed', failure: result.error, items: [], total: 0, source: '',
        })
      }
    })
  }

  /**
   * 打开一条提示词的全文。
   * @param id - 条目 id。
   */
  const openDetail = (id: string): void => {
    detailSeq.current += 1
    const seq = detailSeq.current
    setCopied(false)
    actions.patchLibrary({ selectedId: id, detail: null, detailStatus: 'searching', failure: '' })
    void fetchLibraryDetail(id).then((result) => {
      if (seq !== detailSeq.current) return
      if (result.ok) actions.patchLibrary({ detailStatus: 'ready', detail: result.value })
      else actions.patchLibrary({ detailStatus: 'failed', failure: result.error })
    })
  }

  /** 回到列表视图（保留上次的检索结果，并使在途的详情响应作废）。 */
  const backToList = (): void => {
    detailSeq.current += 1
    setCopied(false)
    actions.patchLibrary({ selectedId: '', detail: null, detailStatus: 'idle', failure: '' })
  }

  /** 复制原文到剪贴板。 */
  const copyContent = (): void => {
    if (detail === null) return
    void copyText(detail.content).then(ok => setCopied(ok))
  }

  /** 发送原文并关闭弹窗（与表单成稿走同一条发送链路）。 */
  const send = (): void => {
    if (detail === null) return
    onSend(detail.content)
    onClose()
  }

  const detailView = (
    <>
      <div style={{ ...rowStyle, gap: 8 }}>
        <SmallButton title="返回检索结果" onClick={backToList}>← 返回</SmallButton>
        <span
          style={{
            fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {detail === null ? '' : (detail.title === '' ? '(无标题)' : detail.title)}
        </span>
      </div>
      {library.detailStatus === 'searching' ? (
        <p role="status" style={captionStyle}>读取全文…</p>
      ) : library.detailStatus === 'failed' ? (
        <p role="status" style={{ ...captionStyle, color: COLORS.danger }}>{library.failure}</p>
      ) : detail === null ? (
        <p role="status" style={captionStyle}>这条提示词没有可显示的内容</p>
      ) : (
        <>
          {detail.description === '' ? null : <p style={captionStyle}>{detail.description}</p>}
          <pre data-library-content="" style={contentStyle}>{detail.content}</pre>
        </>
      )}
    </>
  )

  const detailReady = library.detailStatus === 'ready' && detail !== null

  return (
    <div
      style={maskStyle}
      role="presentation"
      // 与表单弹窗一样刻意不绑定点击关闭：误触不该丢掉已经检索到的东西。
    >
      <div
        data-structured-prompt-library=""
        style={modalStyle}
        role="dialog"
        aria-modal
        aria-label="提示词库"
      >
        <div style={modalHeadStyle}>
          <div style={{ ...rowStyle, flex: '1 1 auto', minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>提示词库</span>
            <span style={{ color: COLORS.caption, fontSize: 12 }}>
              {inDetail ? '原文预览：未经本插件整理，直接发送的就是这段文本' : '检索公共提示词库里的提示词'}
            </span>
          </div>
          <SmallButton
            title="关闭（不改动输入框内容）"
            ariaLabel="关闭"
            style={{ minWidth: 28, padding: '0 6px', fontSize: 14, lineHeight: 1 }}
            onClick={onClose}
          >
            ×
          </SmallButton>
        </div>

        <div data-scroll="" style={modalBodyStyle}>
          {inDetail
            ? detailView
            : <LibraryList library={library} actions={actions} onSearch={runSearch} onOpen={openDetail} />}
        </div>

        <div style={modalFootStyle}>
          {detailReady ? (
            <>
              <span style={captionStyle}>
                {copied ? '已复制到剪贴板' : '来自提示词库的原文，未经本插件整理'}
              </span>
              <div style={{ ...rowStyle, flexWrap: 'wrap' }}>
                <SmallButton title="复制原文到剪贴板" onClick={copyContent}>复制</SmallButton>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  title="把这段原文作为一条用户消息发送进当前会话"
                  onClick={send}
                >
                  发送原始提示词
                </button>
              </div>
            </>
          ) : (
            <span style={captionStyle}>
              {library.source === ''
                // 还没检索过、或宿主没带回来源名时的中性说明。
                ? '来源：公共提示词库（请求由宿主代发，浏览器不直连）'
                : `来源：${library.source}（社区公开提示词库，请求由宿主代发）`}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
