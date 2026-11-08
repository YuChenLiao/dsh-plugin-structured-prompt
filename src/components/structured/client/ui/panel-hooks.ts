/**
 * 表单外壳（弹窗 / 侧栏 tab）共用的副作用。
 *
 * 拆出来的理由很实在：表单本体只有一份，挂在两个外壳里 —— 弹窗（`Modal.tsx`）与侧栏 tab
 * （`SidebarForm.tsx` / `BetterTab.tsx`）。"扩写请求"与"库 → 表单交接"两件事与外壳无关，复制
 * 一份迟早会走偏（一处改了序号防护、另一处没改），所以抬进这里。
 *
 * 两者都是**副作用**，因此留在容器层而不是 `FormPanel`：表单本体只渲染状态，不碰网络，
 * 也不订阅跨组件的交接。
 */
import { useEffect } from 'react'
import type { AssistState, PromptForm } from '../../shared/types.js'
import type { FormActions } from '../actions.js'
import { requestAssist } from '../assist.js'
import type { AssistResult } from '../assist.js'
import { onFormPatch } from '../../../../shared/assist-bridge.js'

/**
 * 揭示表单的入口。
 *
 * 返回 `false` 表示当前没有可用通路（例如宿主的 tab 没开成），调用方自己退回弹窗 ——
 * 于是"降级"是一行返回值，而不是两个组件各写一套判断。
 * @param sessionId - 目标会话（`dsh-better-sidebar` 的后端要靠它定位 tab）。
 */
export type Reveal = (sessionId?: string) => boolean

/** 扩写请求的序号，按会话记：两个外壳同时挂载时共用一个计数，慢响应才不会盖掉新的一次。 */
const assistSeq = new Map<string, number>()

/**
 * 取下一次扩写的序号。
 * @param sessionId - 会话标识；无会话时用空串（同一份"根"计数）。
 * @returns 递增后的序号。
 */
export function nextAssistSeq(sessionId: string | undefined): number {
  const key = sessionId ?? ''
  const next = (assistSeq.get(key) ?? 0) + 1
  assistSeq.set(key, next)
  return next
}

/**
 * 某个结果是否仍然是最新一次请求的。
 * @param sessionId - 会话标识。
 * @param seq - 该请求发起时取到的序号。
 * @returns 仍然最新则为 `true`。
 */
export function isLatestAssist(sessionId: string | undefined, seq: number): boolean {
  return assistSeq.get(sessionId ?? '') === seq
}

/**
 * 把一次成功的扩写结果落进表单。
 *
 * 三件事的顺序有讲究：只合并模型给到的字段（`mergeForm`，不是整表替换）、清掉"套用模板"标记
 * （扩写不是模板套用）、再把成功状态写进去（顺带清掉上一次的 error）。
 * @param actions - store 动作。
 * @param value - 宿主返回的补丁与告警。
 */
export function commitAssistResult(actions: FormActions, value: AssistResult): void {
  actions.mergeForm(value.patch)
  actions.setAppliedTemplate('')
  actions.patchAssist({ status: 'done', error: '', warnings: [...value.warnings] })
}

/** 扩写执行器的入参。 */
export interface AssistRunnerOptions {
  /** 当前表单（随请求一起发，避免把用户已填的字段冲掉）。 */
  readonly form: PromptForm
  /** 扩写状态。 */
  readonly assist: AssistState
  /** store 动作。 */
  readonly actions: FormActions
  /** 会话标识；无会话时无法发请求。 */
  readonly sessionId: string | undefined
}

/** 可注入的请求实现与序号器具（离线测试用）。 */
export interface AssistSeams {
  /** 发请求的实现，默认走同源路由。 */
  readonly request?: typeof requestAssist
  /** 取号，默认按会话递增。 */
  readonly nextSeq?: (sessionId: string | undefined) => number
  /** 判断"是否仍是最新一次"，默认查同一份计数。 */
  readonly latest?: (sessionId: string | undefined, seq: number) => boolean
}

/**
 * 跑一次扩写，把结果落进表单。
 *
 * 三重防护（与库检索同一套手法）：进行中不再发、内容为空不发、序号不符的响应直接丢弃。
 * 抽成纯函数（而不是只在 hook 里）是为了让这三条能被离线断言 —— 它们全是"坏掉之后仍然全绿"
 * 的高危路径：SSR 跑不到 effect，也点不了按钮。
 * @param actions - store 动作。
 * @param options - 表单、扩写状态、动作与会话标识。
 * @param seams - 可注入的请求实现与序号器具。
 * @returns 请求结束（含被丢弃）时 resolve 的 Promise。
 */
export function runAssist(
  actions: FormActions,
  { form, assist, sessionId }: AssistRunnerOptions,
  seams: AssistSeams = {},
): Promise<void> {
  const request = seams.request ?? requestAssist
  const nextSeq = seams.nextSeq ?? nextAssistSeq
  const latest = seams.latest ?? isLatestAssist
  // 进行中不再发：防连点。
  if (assist.status === 'running') return Promise.resolve()
  const brief = assist.brief.trim()
  // 空需求不发；无会话无处发。
  if (brief === '' || sessionId === undefined) return Promise.resolve()
  const mine = nextSeq(sessionId)
  actions.patchAssist({ status: 'running', error: '', warnings: [] })
  return request({ action: 'expand', brief, current: form }, sessionId).then((result) => {
    // 序号不符：慢响应不该覆盖新的一次。
    if (!latest(sessionId, mine)) return
    if (!result.ok) {
      actions.patchAssist({ status: 'failed', error: result.error })
      return
    }
    commitAssistResult(actions, result.value)
  })
}

/**
 * 把「请宿主扩写一次」包成一个可点的回调。
 *
 * 序号按**会话**记在模块级，而不是组件内的 ref：弹窗与侧栏 tab 可能同时挂载，各自一个 ref
 * 就等于两个发起者互不知情，慢的那次会盖掉新的一次。
 * @param options - 表单、扩写状态、动作与会话标识。
 * @returns 触发一次扩写的回调。
 */
export function useAssistRunner(options: AssistRunnerOptions): () => void {
  return () => {
    void runAssist(options.actions, options)
  }
}

/**
 * 接收提示词库交过来的字段补丁（"转化为表单"）。
 *
 * 用一次性事件而不是共享状态：收不到就丢掉，不留下需要清理的残留。
 * @param actions - store 动作。
 * @param reveal - 揭示表单的入口；缺省时直接打开弹窗。
 * @param sessionId - 目标会话（转交给 `reveal`）。
 */
export function useFormPatch(actions: FormActions, reveal?: Reveal, sessionId?: string): void {
  useEffect(() => onFormPatch((patch) => {
    actions.mergeForm(patch)
    // 转化结果不是"套用模板"：套用标记要清掉，否则场景条会声称表单来自某套内置模板。
    actions.setAppliedTemplate('')
    actions.patchAssist({ status: 'done', error: '', warnings: [] })
    // 侧栏接管时关掉弹窗，避免两份外壳同屏（`active` 只有弹窗这条路会写）。
    if (reveal !== undefined && reveal(sessionId)) actions.close()
    else actions.open()
  }), [actions, reveal, sessionId])
}
