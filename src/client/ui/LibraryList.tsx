/**
 * 提示词库弹窗的列表视图：搜索行 + 状态行 + 结果列表。
 *
 * 从 `LibraryModal.tsx` 拆出（单文件行数上限）。它只接收状态与回调、自己不发起请求 ——
 * 请求由容器负责，与表单弹窗把副作用留在 `Modal` 的分工一致。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { LibraryState } from '../../shared/library.js'
import type { FormActions } from './actions.js'
import { SmallButton, TextInput } from './base.js'
import { COLORS, buttonStyle, rowStyle } from './styles.js'

/** 结果条目：整块可点，长文本换行（`buttonStyle` 是为单行按钮写的，这里要覆盖几处）。 */
const itemStyle: CSSProperties = {
  ...buttonStyle,
  display: 'block',
  width: '100%',
  height: 'auto',
  padding: '8px 10px',
  textAlign: 'left',
  whiteSpace: 'normal',
}

/** 列表视图的 props。 */
export interface LibraryListProps {
  /** 检索弹窗状态。 */
  library: LibraryState
  /** store 动作（查询词经它写回）。 */
  actions: FormActions
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
      <div style={{ ...rowStyle, gap: 8 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <TextInput
            value={library.query}
            ariaLabel="检索提示词"
            placeholder="例如：code review、文章大纲、SQL 优化"
            onChange={value => actions.patchLibrary({ query: value })}
          />
        </div>
        <SmallButton title="检索提示词库" onClick={onSearch}>检索</SmallButton>
      </div>
      <p
        role="status"
        style={{ margin: 0, fontSize: 12, color: library.status === 'failed' ? COLORS.danger : COLORS.caption }}
      >
        {statusLine}
      </p>
      <div data-library-list="" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {library.items.map(item => (
          <button
            key={item.id}
            type="button"
            data-library-item={item.id}
            style={itemStyle}
            title="查看全文"
            onClick={() => onOpen(item.id)}
          >
            <span style={{ display: 'block', fontWeight: 600 }}>
              {item.title === '' ? '(无标题)' : item.title}
            </span>
            {item.description === '' ? null : (
              <span style={{ display: 'block', fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>
                {item.description}
              </span>
            )}
            {item.author === '' ? null : (
              <span style={{ display: 'block', fontSize: 11, color: COLORS.caption, marginTop: 2 }}>
                {`@${item.author}`}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}
