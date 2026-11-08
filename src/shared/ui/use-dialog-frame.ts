/**
 * 按**弹窗自己所在的列**居中，而不是按整个视口。
 *
 * 右侧栏（宿主的右列）打开时会挤压中间列 —— DSH 的 `AppFrame` 是 grid 布局，右栏是网格列，
 * 展开时 `grid-template-columns` 变化，中间列随之变窄。而 `position: fixed` 的遮罩仍以视口为
 * 基准，于是弹窗偏右、被右栏压住。
 *
 * 两个弹窗共用它（结构化表单与提示词库）—— 它们的遮罩需要同一个基准。
 *
 * **基准怎么找**：见 {@link findColumn}。要点是不能取"第一个比视口窄的祖先"（工具栏、浮层这类
 * 局部容器全都比视口窄），也不能取"最宽的"（上层可能有位置偏右的包裹层）。取**第一个够宽的**。
 *
 * **`position: fixed` 的包含块未必是视口**：某个祖先带 `transform` / `filter` / `will-change`
 * 时，包含块会变成那个祖先，`left` 于是相对它而不是视口。真机实测过：算出的 `left: 280` 被
 * 应用成 `rect.left = 560`（280 + 280）—— 遮罩自己相对视口偏了一整段。所以测量时先把 `left`
 * 归零读一次实际渲染位置，那个值就是包含块原点的视口坐标，减掉它才落到真实位置。
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

/** 遮罩定位只需要这几个数：免得多处重复写 DOMRect 的形状。 */
export interface FrameRect {
  /** 列的左边界（视口坐标）。 */
  readonly left: number
  /** 列的宽度。 */
  readonly width: number
  /** 列的高度（只用于判断"这一列已经布局好了没有"）。 */
  readonly height: number
}

/**
 * 由列的矩形算出遮罩的定位样式。
 *
 * 抽成纯函数是为了让"基准是这一列"这件事**可以离线断言** —— 真实浏览器不可用时，至少
 * 「给定 rect → 给定样式」这条映射能被守住。
 *
 * 尺寸无效（0 宽或 0 高：列尚未布局、或被 `display: none` 隐藏）时返回空对象，让遮罩保持
 * CSS 的 `inset: 0`。否则会把 `width: 0` 写进去，弹窗整块不可见 —— 概率低但代价高。
 * @param rect - 遮罩所在列的矩形。
 * @param blockOrigin - 包含块原点在视口中的 x 坐标（正常是 0；祖先带 transform 时不为 0）。
 * @returns 覆盖给遮罩的定位样式。
 */
export function frameFromRect(rect: FrameRect, blockOrigin = 0): CSSProperties {
  if (!(rect.width > 0) || !(rect.height > 0)) return {}
  return { left: rect.left - blockOrigin, width: rect.width, right: 'auto' }
}

/** 判定"比视口窄"时留的容差（px）：列边框与滚动条会让列宽略小于视口宽。 */
const NARROW_TOLERANCE_PX = 8

/** 判定"够宽"的比例阈值：工具栏、浮层、单行按钮组都在三成以下。 */
const MIN_COLUMN_RATIO = 0.3

/**
 * 从遮罩出发，找**它真正所在的那一列**。
 *
 * 取**第一个"够宽"**的祖先（宽于视口三成）：
 *  - 不作为"第一个比视口窄的"—— 工具栏/浮层这类局部容器全都比视口窄，第一个命中的往往是它们，
 *    遮罩就贴着那个小容器（真机现象：空会话居中正常，一有对话就偏右）；
 *  - 也不取"最宽的"—— 更上层可能有"比视口窄、但位置偏右"的包裹层，最宽会选中它们。
 *
 * 找不到时返回起点（退化成"按视口居中"）。
 * @param start - 遮罩元素。
 * @returns 作为定位基准的元素。
 */
function findColumn(start: HTMLElement): HTMLElement {
  const viewport = window.innerWidth
  let node: HTMLElement | null = start
  while (node !== null && node !== document.body) {
    const width = node.clientWidth
    if (width >= viewport * MIN_COLUMN_RATIO && width < viewport - NARROW_TOLERANCE_PX) return node
    node = node.parentElement
  }
  return start
}

/**
 * 观察遮罩所在列并返回覆盖给遮罩的定位样式。
 *
 * 测不到时（SSR、或挂载点尚未进 DOM）返回空对象：遮罩退回整视口居中。
 * @param ref - 遮罩元素（基准从它出发向上找）。
 * @returns 定位样式；测不到时为空对象。
 */
export function useDialogFrame<T extends HTMLElement>(ref: RefObject<T | null>): CSSProperties {
  const [frame, setFrame] = useState<CSSProperties>({})
  useEffect(() => {
    const measure = (): void => {
      const mask = ref.current
      if (mask === null || mask === undefined) return
      const column = findColumn(mask)
      const rect = column.getBoundingClientRect()

      // 量包含块原点：把 `left` 归零、读一次实际渲染位置，那个值就是原点（祖先带 transform 时
      // 它不是 0），随后恢复。这一步必须做，否则 `left` 会被包含块偏移叠加一次。
      const previous = mask.style.left
      mask.style.left = '0px'
      const blockOrigin = mask.getBoundingClientRect().left
      mask.style.left = previous

      setFrame(frameFromRect(rect, blockOrigin))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    // 观察遮罩的父元素即可：列宽变化会传导到它，因此不必先知道列在哪。
    const anchor = ref.current?.parentElement
    if (anchor !== null && anchor !== undefined) observer?.observe(anchor)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref])
  return frame
}

/**
 * 把定位样式压成一个可读的锚点值，挂在遮罩的 `data-dsh-prompt-frame` 上。
 *
 * 真实布局离线测不了，所以出问题时需要一眼看出"到底按哪一列、算成了多少"。空对象表示退回整视口
 * 居中；否则给出实际使用的 `left` 与 `width`，截图就能带上这两个数。
 * @param style - `useDialogFrame` 返回的样式。
 * @returns `viewport` 或 `column:<left>/<width>`。
 */
export function frameAnchor(style: CSSProperties): string {
  if (Object.keys(style).length === 0) return 'viewport'
  const record = style as Record<string, unknown>
  return `column:${String(record['left'])}/${String(record['width'])}`
}
