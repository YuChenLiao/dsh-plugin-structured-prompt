/**
 * 样式文件的模块声明。
 *
 * 构建期由 `tools/lib/build.mjs` 的 CSS 插件把 `*.css` / `*.module.css` 编译成注入模块
 * （与 DSH 官方客户端包同一套做法），所以类型层只需要"这是个模块"这一条事实。
 *
 * 这里刻意不声明 `*.module.css` 的 key 集合：class 名是构建期 hash 出来的（`[hash]_[local]`），
 * 在类型层复刻一份等于给自己造第二个真源。组件侧统一用 `Readonly<Record<string, string>>`
 * 的写法引用，并由渲染测试核对 class 真的存在。
 */

// 顺序有讲究：TS 对 ambient module 的通配符是**先声明先匹配**，不是"最具体优先"，
// 所以更具体的 `*.module.css` 必须写在宽泛的 `*.css` 之前，否则模块会被解析成 string。
declare module '*.module.css' {
  /** hashed 之后的类名映射：`import s from './x.module.css'` → `s.button`。 */
  const classes: Readonly<Record<string, string>>
  export default classes
}

declare module '*.css' {
  /** 编译后的 CSS 文本（本插件的用法是副作用导入，构建期即完成注入）。 */
  const css: string
  export default css
}
