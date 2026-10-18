/**
 * 提示词库检索弹窗（本组件在 `conversation.input.dock` 上的那一条注册）。
 *
 * 与结构化组件的表单弹窗**互不干涉**：各有自己的 store 与开关，两个弹窗可以同时打开。与构建器
 * 则完全隔离 —— 检索到的是别人的成品提示词，不做字段校验、不填进表单。这里只做三件事：检索、
 * 预览、发送（或复制）。列表视图在 `LibraryList.tsx`，拆开是为了单文件行数上限；本文件留弹窗外壳、
 * 详情视图与请求副作用。
 *
 * 请求打的是宿主注册的两条**同源**路由（上游没有 CORS 头，浏览器直连会被拒），所以本组件
 * 只认识路径，不认识上游地址 —— 界面文案因此也**不写死上游域名**（`config.libraryBaseUrl`
 * 可以指向自托管实例）。发送走与表单成稿**同一条**链路（宿主的 `onSend`）。
 */
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LibraryState } from '../../shared/library.js'
import type { LibraryComponentActions } from '../actions.js'
import { SmallButton } from '../../../../shared/ui/base.js'
import { copyText } from '../../../../shared/ui/clipboard.js'
import { fetchLibraryDetail, searchLibrary, searchPatch } from '../library.js'
import { LibraryList } from './LibraryList.js'
import s from '../../../../shared/ui/panel.module.css'
import { useDialogFrame } from '../../../../shared/ui/use-dialog-frame.js'
import { requestAssist } from '../../../structured/client/assist.js'
import { offerFormPatch } from '../../../../shared/assist-bridge.js'

/** 检索弹窗的 props。 */
export interface LibraryModalProps {
  /** 检索弹窗状态。 */
  library: LibraryState
  /** store 动作。 */
  actions: LibraryComponentActions
  /** 关闭弹窗。 */
  onClose: () => void
  /** 把选中的提示词作为一条用户消息投递进当前会话。 */
  onSend: (text: string) => void
  /** 会话标识：转化走宿主路由时要用（模型从会话继承）。 */
  sessionId?: string
}

/**
 * 提示词库弹窗。
 * @param props - 状态、动作与回调。
 * @returns 弹窗元素。
 */
export function LibraryModal({
  library, actions, onClose, onSend, sessionId,
}: LibraryModalProps): ReactNode {
  const [copied, setCopied] = useState(false)
  // 转化是异步副作用，状态放本地与 copied 同构：不进 store，也不需要跨刷新保留。
  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState('')
  // 请求序号：只有最后一次发起的请求能写状态。没有这个比对时，快速连续检索、或"先点 A 再点
  // B"会让慢的那个响应覆盖新状态（详情与所选条目错位）。
  const searchSeq = useRef(0)
  const detailSeq = useRef(0)
  const maskRef = useRef<HTMLDivElement>(null)
  // 遮罩按弹窗所在的列居中（右栏开合会自动跟随），与表单弹窗共用同一处实现。
  const dialogFrame = useDialogFrame(maskRef)
  const detail = library.detail
  const inDetail = library.selectedId !== ''

  /** 检索：状态先落到 store（界面据此显示"检索中"），结果或失败再落一次。 */
  const runSearch = (): void => {
    searchSeq.current += 1
    const seq = searchSeq.current
    actions.patch({
      status: 'searching', failure: '', items: [], total: 0,
      selectedId: '', detail: null, detailStatus: 'idle',
    })
    void searchLibrary(library.query).then((result) => {
      if (seq !== searchSeq.current) return
      if (result.ok) {
        // 用 `searchPatch` 而不是在这里逐字段挑：跨半边的这一步（响应 → store）因此有断言守着。
        actions.patch(searchPatch(result.value))
      } else {
        // 失败时把来源名一并清掉 —— 底部不该继续显示上一次成功时的来源。
        actions.patch({
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
    actions.patch({ selectedId: id, detail: null, detailStatus: 'searching', failure: '' })
    void fetchLibraryDetail(id).then((result) => {
      if (seq !== detailSeq.current) return
      if (result.ok) actions.patch({ detailStatus: 'ready', detail: result.value })
      else actions.patch({ detailStatus: 'failed', failure: result.error })
    })
  }

  /** 回到列表视图（保留上次的检索结果，并使在途的详情响应作废）。 */
  const backToList = (): void => {
    // 序号自增让在途的详情响应作废 —— 这是本组件的责任，store 的 `backToList` 只负责清状态。
    detailSeq.current += 1
    setCopied(false)
    actions.backToList()
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

  /**
   * 把原文拆成结构化字段，交给结构化组件的表单。
   *
   * 结果**不经由对话**：宿主路由 → 模型 → 补丁 → bridge 一次性交给表单组件并打开它。
   * 与「发送原始提示词」是两条不同的路：那条把原文当消息发出去，这条只改表单、对话里不留痕。
   */
  const convert = (): void => {
    if (detail === null || sessionId === undefined || converting) return
    setConverting(true)
    setConvertError('')
    void requestAssist({ action: 'convert', source: detail.content, title: detail.title }, sessionId)
      .then((result) => {
        if (!result.ok) {
          setConvertError(result.error)
          return
        }
        // 没有订阅者说明结构化组件当前没挂载；这时"填好并打开"无处呈现，明确告知而不是静默丢弃。
        if (offerFormPatch(result.value.patch) === 0) {
          setConvertError('已转化，但结构化表单当前未挂载，无处填入')
          return
        }
        onClose()
      })
      .finally(() => { setConverting(false) })
  }
  const detailView = (
    <>
      <div className={s.searchRow}>
        <SmallButton title="返回检索结果" onClick={backToList}>← 返回</SmallButton>
        <span className={s.detailTitle}>
          {detail === null ? '' : (detail.title === '' ? '(无标题)' : detail.title)}
        </span>
      </div>
      {library.detailStatus === 'searching' ? (
        <p role="status" className={s.captionText}>读取全文…</p>
      ) : library.detailStatus === 'failed' ? (
        <p role="status" className={s.dangerCaption}>{library.failure}</p>
      ) : detail === null ? (
        <p role="status" className={s.captionText}>这条提示词没有可显示的内容</p>
      ) : (
        <>
          {detail.description === '' ? null : <p className={s.captionText}>{detail.description}</p>}
          <pre data-library-content="" className={s.libraryContent}>{detail.content}</pre>
        </>
      )}
    </>
  )

  const detailReady = library.detailStatus === 'ready' && detail !== null

  return (
    <div
      ref={maskRef}
      data-dsh-prompt-mask=""
      // 自证锚点：`column` = 定位已按那一列生效；`viewport` = 退回整视口居中。
      data-dsh-prompt-frame={Object.keys(dialogFrame).length === 0 ? 'viewport' : 'column'}
      className={s.mask}
      style={dialogFrame}
      role="presentation"
      // 与表单弹窗一样刻意不绑定点击关闭：误触不该丢掉已经检索到的东西。
    >
      <div
        data-structured-prompt-library=""
        data-dsh-prompt-panel=""
        className={s.modal}
        role="dialog"
        aria-modal
        aria-label="提示词库"
      >
        <div className={s.modalHead}>
          <div className={s.modalHeadTitle}>
            <span className={s.modalTitle}>提示词库</span>
            <span className={s.modalHint}>
              {inDetail ? '原文预览：未经本插件整理，直接发送的就是这段文本' : '检索公共提示词库里的提示词'}
            </span>
          </div>
          <SmallButton
            title="关闭（不改动输入框内容）"
            ariaLabel="关闭"
            className={s.iconButton}
            onClick={onClose}
          >
            ×
          </SmallButton>
        </div>

        <div data-scroll="" className={s.modalBody}>
          {inDetail
            ? detailView
            : <LibraryList library={library} actions={actions} onSearch={runSearch} onOpen={openDetail} />}
        </div>

        <div className={s.modalFoot}>
          {detailReady ? (
            <>
              <span className={s.captionText}>
                {copied ? '已复制到剪贴板' : '来自提示词库的原文，未经本插件整理'}
              </span>
              <div className={s.footerRow}>
                <SmallButton title="复制原文到剪贴板" onClick={copyContent}>复制</SmallButton>
                <SmallButton
                  title="让模型把这段原文拆解成结构化字段，交给「结构化输入任务」表单"
                  disabled={converting || sessionId === undefined || detail === null}
                  onClick={convert}
                >
                  {converting ? '转化中…' : '转化为表单'}
                </SmallButton>
                <button
                  type="button"
                  className={s.primaryButton}
                  title="把这段原文作为一条用户消息发送进当前会话"
                  onClick={send}
                >
                  发送原始提示词
                </button>
              </div>
              {convertError === '' ? null : (
                <p role="status" className={s.dangerCaption}>{convertError}</p>
              )}
            </>
          ) : (
            <span className={s.captionText}>
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
