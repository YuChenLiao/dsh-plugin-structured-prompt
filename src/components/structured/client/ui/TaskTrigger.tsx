/**
 * 「任务扩写」入口（`conversation.input.left`）。
 *
 * 与另外两个入口的区别是**没有弹窗**：点一下就把输入框里那句话扩写成完整任务、原样回填，
 * 用户接着就能发出去。所以它自己管异步状态，不需要面板，也不需要 store 座位 ——
 * 草稿的读写由宿主提供的 `useInput` / `inputActions` 承担（`SessionStandardProps` 给每个
 * session 作用域槽位都会给这两样）。
 *
 * 两处刻意的克制：
 *
 *  - **不覆盖用户的新输入**。请求要等十几秒，期间用户很可能又补了一句。发起时记下草稿快照，
 *    回来时若当前草稿已经变了，就**不写回**、只在按钮上提示"草稿已变" —— 静默替换掉用户刚
 *    打的字，比不给结果更糟。
 *  - **失败不撑布局**。槽位只有一行按钮，撑不开错误面板，所以按钮文字临时变成"扩写失败"、
 *    `title` 换成具体原因，三秒后自动恢复。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { requestRewrite } from '../assist-task.js'
import s from '../../../../shared/ui/panel.module.css'

/** 输入状态里本组件用到的部分。 */
export interface TaskInputState {
  /** 当前草稿。 */
  readonly draft: string
}

/** `useInput` 的形状（只声明本组件用到的面）。 */
export type TaskUseInput = <T>(selector: (state: TaskInputState) => T) => T

/** 宿主给槽位的输入动作里本组件用到的部分。 */
export interface TaskInputActions {
  /** 替换整个草稿。 */
  setDraft(text: string): void
}

/** 入口按钮的 props。 */
export interface TaskTriggerProps {
  /** 读输入状态。 */
  useInput: TaskUseInput
  /** 写输入状态。 */
  inputActions: TaskInputActions
  /** 会话标识；无会话时禁用。 */
  sessionId?: string
}

/** 提示自动收回的时长（ms）。 */
const HINT_MS = 3000

/**
 * 入口按钮。
 * @param props - 输入读写座位与会话标识。
 * @returns 按钮元素。
 */
export function TaskTrigger({ useInput, inputActions, sessionId }: TaskTriggerProps): ReactNode {
  const draft = useInput(state => state.draft)
  const [running, setRunning] = useState(false)
  const [hint, setHint] = useState('')

  // 连点守卫：`disabled` 依赖 `running`，而同一 tick 内两次点击都能读到旧值 —— 一个 ref 就够。
  const busy = useRef(false)
  // 最新草稿：`.then` 闭包里拿到的是发起时的值，比对"用户期间改没改"必须读渲染时更新的 ref。
  const latestDraft = useRef(draft)
  latestDraft.current = draft

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (timer.current !== undefined) clearTimeout(timer.current) }, [])

  /** 显示一条短暂提示（失败原因或"草稿已变"），到时自动收回。 */
  const flash = (text: string): void => {
    setHint(text)
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = setTimeout(() => setHint(''), HINT_MS)
  }

  const disabled = running || sessionId === undefined || draft.trim() === ''

  const expand = (): void => {
    if (busy.current || disabled) return
    busy.current = true
    setRunning(true)
    setHint('')
    const snapshot = draft.trim()
    void requestRewrite(snapshot, sessionId as string).then((result) => {
      if (!result.ok) {
        flash(result.error)
        return
      }
      // 请求期间用户继续输入时**不覆盖**：那会静默吞掉他刚打的字。
      if (latestDraft.current.trim() !== snapshot) {
        flash('草稿已改动，扩写结果没有覆盖')
        return
      }
      inputActions.setDraft(result.value.text)
    }).finally(() => {
      busy.current = false
      setRunning(false)
    })
  }

  return (
    <button
      type="button"
      data-structured-prompt-task-trigger=""
      data-dsh-prompt-trigger=""
      data-task-status={running ? 'running' : (hint === '' ? 'idle' : 'failed')}
      className={running || hint !== '' ? `${s.trigger} ${s.triggerActive}` : s.trigger}
      title={hint === '' ? '把输入框里的这句话扩写成可以直接发送的完整任务' : hint}
      disabled={disabled}
      onMouseDown={(event) => { event.preventDefault() }}
      onClick={expand}
    >
      {running ? '扩写中…' : (hint === '' ? '任务扩写' : '扩写失败')}
    </button>
  )
}
