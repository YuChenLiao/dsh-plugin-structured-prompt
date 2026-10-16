/**
 * 按**弹窗自己所在的那一列**居中，而不是按整个视口。
 *
 * 右侧栏（宿主的右列）打开时会挤压中间列 —— DSH 的 `AppFrame` 是 grid 布局，右栏是网格列，
 * 展开时 `grid-template-columns` 变化，中间列随之变窄。而 `position: fixed` 的遮罩仍以视口为
 * 基准，于是弹窗偏右、被右栏压住（这是真实反馈里的现象）。
 *
 * 两个弹窗共用它（结构化表单与提示词库）—— 它们的遮罩需要同一个基准。
 *
 * **基准怎么找**：见 {@link findColumn}。要点是**不能只取一层父元素**：槽位的包装层数随 DSH
 * 版本变化，父元素可能仍是整宽容器 —— 第一版修复就是这么失效的（测出来等于视口宽，弹窗照旧
 * 居中，界面上看不出任何变化）。
 *
 * **离线能守住什么**：真实布局测不了，所以这里把「rect → 样式」抽成纯函数 {@link frameFromRect}
 * （可直接断言），并让"基准的判据"成为源码里一眼可见的一行（渲染测试会读本文件断言它没被改回
 * 视口）。
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
 * @returns 覆盖给遮罩的定位样式。
 */
export function frameFromRect(rect: FrameRect): CSSProperties {
  if (!(rect.width > 0) || !(rect.height > 0)) return {}
  return { left: rect.left, width: rect.width, right: 'auto' }
}

/** 判定"比视口窄"时留的容差（px）：列边框与滚动条会让列宽略小于视口宽。 */
const NARROW_TOLERANCE_PX = 8

/**
 * 从遮罩出发，找**被挤压过的那一列**。
 *
 * 判据是"比视口窄"：右侧栏展开后中间列必然窄于视口，而它是这条祖先链上**最内层**的窄元素。
 * 因此不必知道宿主把内容包了几层，也不必去查具体的 `data-slot` 选择器 —— 那些是未公开结构。
 *
 * 找不到时返回起点（退化成"按视口居中"，与不改之前一致）。
 * @param start - 遮罩元素。
 * @returns 作为定位基准的元素。
 */
function findColumn(start: HTMLElement): HTMLElement {
  const viewport = window.innerWidth
  let node: HTMLElement | null = start
  while (node !== null && node !== document.body) {
    if (node.clientWidth > 0 && node.clientWidth < viewport - NARROW_TOLERANCE_PX) return node
    node = node.parentElement
  }
  return start
}

/**
 * 观察遮罩所在列并返回覆盖给遮罩的定位样式。
 *
 * 测不到时（SSR、或挂载点尚未进 DOM）返回空对象：遮罩退回整视口居中，与不改之前的行为一致。
 * @param ref - 遮罩元素（基准从它出发向上找）。
 * @returns 定位样式；测不到时为空对象。
 */
export function useDialogFrame<T extends HTMLElement>(ref: RefObject<T | null>): CSSProperties {
  const [frame, setFrame] = useState<CSSProperties>({})
  useEffect(() => {
    const measure = (): void => {
      const mask = ref.current
      if (mask === null || mask === undefined) return
      setFrame(frameFromRect(findColumn(mask).getBoundingClientRect()))
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
