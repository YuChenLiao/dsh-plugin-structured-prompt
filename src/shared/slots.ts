/**
 * 槽位注册描述：两个客户端组件共用的这一形状。
 *
 * 提出来是因为拆分后**两个组件各自返回自己的注册清单**（`structuredSlotEntries` /
 * `librarySlotEntries`），聚合入口与测试都需要一个共同的类型，而不是各自定义一份。
 */

/** 一个槽位注册描述。 */
export interface SlotEntry {
  /** 目标槽位键。 */
  readonly name: string
  /** 注册选项（含 `store` 座位）。 */
  readonly options: Record<string, unknown>
  /** 组件。 */
  readonly component: (props: never) => unknown
}
