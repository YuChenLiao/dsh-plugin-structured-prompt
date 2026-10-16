/**
 * 按**弹窗自己所在的列**居中，而不是按整个视口。
 *
 * 右侧栏（宿主的右列）打开时对话列会变窄，而 `position: fixed` 的遮罩仍以视口为基准 ——
 * 弹窗于是偏右、被右栏压住（这是真实反馈里的现象）。这里测量挂载点所在的那一列，把它的
 * `left` / `width` 交给遮罩，因此右栏开合与窗口缩放都会跟着重测。
 *
 * 两个弹窗共用它（结构化表单与提示词库）—— 它们的遮罩需要同一个基准。
 *
 * **基准的准确含义**：`maskRef.parentElement` 是 `conversation.input.dock` 的宿主容器，
 * 它的宽度等于输入区宽度（含其 padding）。所以弹窗是"以那一列为基准"，而不是严格意义上的
 * 对话列——方向正确、幅度很小，但不要在文档里写成"严格居中于对话列"。
 *
 * **离线能守住什么**：真实布局测不了，所以这里刻意把「rect → 样式」抽成纯函数
 * {@link frameFromRect}（可直接断言），并让"基准取自哪个元素"成为源码里一眼可见的一行
 * （渲染测试会读本文件断言它没被改回视口）。
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

/**
 * 观察遮罩所在列并返回覆盖给遮罩的定位样式。
 *
 * 测不到时（SSR、或挂载点尚未进 DOM）返回空对象：遮罩退回整视口居中，与不改之前的行为一致。
 * @param ref - 遮罩元素（其父元素即挂载点所在的列）。
 * @returns 定位样式；测不到时为空对象。
 */
export function useDialogFrame<T extends HTMLElement>(ref: RefObject<T | null>): CSSProperties {
  const [frame, setFrame] = useState<CSSProperties>({})
  useEffect(() => {
    const column = ref.current?.parentElement
    if (column === null || column === undefined) return undefined
    const measure = (): void => { setFrame(frameFromRect(column.getBoundingClientRect())) }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(column)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref])
  return frame
}
