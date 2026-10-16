/**
 * 提示词库弹窗的列表视图：搜索行 + 状态行 + 结果列表。
 *
 * 从 `LibraryModal.tsx` 拆出（单文件行数上限）。它只接收状态与回调、自己不发起请求 ——
 * 请求由容器负责，与表单弹窗把副作用留在 `Modal` 的分工一致。
 *
 * 样式在 CSS Modules 里（`shared/ui/panel.module.css`）。
 */
import type { ReactNode } from 'react'
import type { LibraryState } from '../../shared/library.js'
import type { LibraryComponentActions } from '../actions.js'
import { SmallButton, TextInput } from '../../../../shared/ui/base.js'
import s from '../../../../shared/ui/panel.module.css'

/** 列表视图的 props。 */
export interface LibraryListProps {
  /** 检索弹窗状态。 */
  library: LibraryState
  /** store 动作（查询词经它写回）。 */
  actions: LibraryComponentActions
  /** 发起一次检索。 */
  onSearch: () => void
  /** 打开某一条的全文。 */
  onOpen: (id: string) => void
}

/**
 * 列表视图。
 * @param props - 状态与回调。
 * @returns 搜索行、状态行与结果列表。
 */
export function LibraryList({ library, actions, onSearch, onOpen }: LibraryListProps): ReactNode {
  const statusLine = (() => {
    if (library.status === 'searching') return '检索中…'
    if (library.status === 'failed') return library.failure
    if (library.status !== 'ready') return '输入关键词后点「检索」；留空则列出最新的一批'
    if (library.items.length === 0) return '没有命中任何提示词'
    return library.total > library.items.length
      ? `共 ${library.total} 条，显示前 ${library.items.length} 条`
      : `命中 ${library.items.length} 条`
  })()

  return (
    <>
      <div className={s.searchRow}>
        <div className={s.grow}>
          <TextInput
            value={library.query}
            ariaLabel="检索提示词"
            placeholder="例如：code review、文章大纲、SQL 优化"
            onChange={value => actions.patch({ query: value })}
          />
        </div>
        <SmallButton title="检索提示词库" onClick={onSearch}>检索</SmallButton>
      </div>
      <p
        role="status"
        className={library.status === 'failed' ? s.dangerCaption : s.captionText}
      >
        {statusLine}
      </p>
      <div data-library-list="" className={s.libraryList}>
        {library.items.map(item => (
          <button
            key={item.id}
            type="button"
            data-library-item={item.id}
            className={s.itemButton}
            title="查看全文"
            onClick={() => onOpen(item.id)}
          >
            <span className={s.itemTitle}>
              {item.title === '' ? '(无标题)' : item.title}
            </span>
            {item.description === '' ? null : (
              <span className={s.itemDescription}>
                {item.description}
              </span>
            )}
            {item.author === '' ? null : (
              <span className={s.itemAuthor}>
                {`@${item.author}`}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}
