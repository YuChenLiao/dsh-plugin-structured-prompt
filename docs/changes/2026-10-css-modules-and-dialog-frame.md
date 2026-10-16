# 弹窗定位修复 + 样式迁进 CSS Modules（2026-10）

## 起点：使用者报的两件事

1. **弹窗与右侧栏冲突**：「弹窗位置应该是始终位于**对话窗口**的中间，而不是整个窗口中间」。
   截图里结构化表单弹窗压到了右侧栏底下。
2. **样式写法**：「样式全部写进了 ts 文件里，这个做法极其不专业且不利于维护，建议抽出成为单独的
   css 文件或者采用和 dsh 一样的样式方案」。

## 定位：按弹窗自己所在的列居中

成因：遮罩是 `position: fixed` + `inset: 0` + flex 居中 —— 基准是**视口**。右侧栏（宿主的右列）打开时
对话列变窄，弹窗于是偏右、被右栏压住。

修法是新增 `src/shared/ui/use-dialog-frame.ts`：测量遮罩的 `parentElement`（即 `conversation.input.dock`
挂载点所在的那一列），把它的 `left` / `width` 交给遮罩，并用 `ResizeObserver` + `resize` 事件跟随；
测不到时返回空对象，遮罩退回 CSS 的 `inset: 0`（与改动前一致）。两个弹窗共用同一处实现。

三处刻意的取舍：

- **不碰宿主的 DOM 结构**。没有去查 `#root [data-slot="main.conversation"]` 之类的选择器（`dsh-better-sidebar`
  的底部工作台就那么做），而是量自己的挂载点 —— 后者是官方槽位语义内的东西，宿主改结构也不会碎。
- **基准的准确含义写清楚**：`parentElement` 是 dock 的宿主容器，宽度等于输入区宽度（含其 padding），
  所以弹窗是"以那一列为基准"，**不要**在文档里写成"严格居中于对话列"。
- **尺寸无效时不写定位**：列尚未布局或被 `display: none` 隐藏时若把 `width: 0` 写进去，弹窗整块不可见
  —— 概率低但代价高，所以 `frameFromRect` 直接返回空对象。

## 样式：照 DSH 官方那套（lightningcss 构建期编译 + 注入）

读 `packages/client/tsdown.client.ts` 得到官方做法：`x.module.css` 产出 hashed class map 并在 factory
执行时注入 tagged style，`x.css?inline` 导出编译文本供插件自己注入；编译用 **lightningcss**，虚拟 id 的
后缀刻意不是 `.css`（否则会落进 tsdown 自己的 CSS 管道）。

`tools/lib/build.mjs` 照同一套实现了插件（lightningcss 从 DSH 源码树加载，**没有新增依赖**）：

- `src/shared/ui/panel.css` —— 全局注入那份：伪类、滚动条、锚在 `[data-dsh-prompt-panel]` /
  `[data-dsh-prompt-trigger]` 上的后代选择器（这两个共享属性是「样式打坏弹窗」那次事故后立的规矩）。
- `src/shared/ui/panel.module.css` —— 组件引用的类，含三条布局不变量（不裁剪、不压缩、唯一滚动容器），
  由渲染测试**读文件文本**断言。
- **删掉** `src/shared/ui/styles.ts`（15 个内联样式对象）与 `theme.ts`（颜色 token）—— 颜色一律用宿主的
  `--dsw-*` 变量，带原来的回退值。
- **删掉**插件入口里的手写 `installStyles`（`ctx.effect` + `style[data-plugin-css]` 去重）—— 注入现在是
  构建产物的责任，幂等由生成的模块自己保证。
- **消掉一处双真源**：文本域高度上限原来 JS（`TEXTAREA_MAX_PX`）与样式各写一份，现在只在 `.textarea`
  写，`fitTextArea` 从 `getComputedStyle().maxHeight` 读同一个值。

迁移后全 `src` 只剩 **4 处**内联 `style`，全是无法静态化的动态值：两处 `dialogFrame`、`base.tsx` 的
`fieldSizing` 能力探测、`SmallButton` 的透传口（审查提示这个透传口可能已无调用方，见「待决策」）。

## 契约与不变量

- **黄金样本 25 条逐字未变**（本批不碰构建器，`tests/golden/` 未被 diff 触及）。
- host 产物仍三个、每个零 import；`lib/client.js` 保持 `__ModuleLoader__.load` 包装 + 三个共享模块 require。
- **新增断言：产物里必须有样式注入器**（`data-plugin-css` + `data-dsh-prompt-panel`）—— 否则"样式搬进
  css 文件"就只是换个地方放、实际没人注入。
- 注册契约那条**反过来写**：`apply` 不该再自己注入样式（否则同一份样式会被注入两次）。
- 渲染测试的样式断言换了口径：原来断言"内联样式出现在 HTML 里"，现在读样式文件文本断言（新增
  `ruleOf(className)` 辅助），并补了"遮罩以 fixed + inset 作回退"与"按列居中在共享实现里"两条。

## 审查记录

| 轮次 | 范围 | 结论 |
| --- | --- | --- |
| 第一轮 | 待提交的完整改动（含产物） | **无阻断，2 条需修 + 7 条建议**。需修两条都是"本批改动没有守护"，且都经副本突变证实：把定位基准换成 `documentElement`（就是使用者反馈的那个 bug）、把 `s.modal` 写成 `s.modalTypo`，**八套测试全绿**。审查同时逐条核对了迁移等价性（14 个样式对象 + token 与旧内联**每条声明都一致**，含 `composes`、`letter-spacing`、`scrollbar-gutter` 这些易漏项）、漏迁（干净）、构建插件有效性（改 CSS 一个值 → 重建 → 产物新值出现）、50 个类无死类、产物契约完好 |

### 采纳

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | 定位修复零守护 | 抽出纯函数 `frameFromRect(rect)`（可直接断言）＋ 静态断言"基准取 `parentElement` 而非视口"＋ 兜底断言。反向验证：把基准换成视口 → 两条红 |
| 2 | 类名 typo 零守护（本批风险最大处） | 渲染测试抓 SSR 产物的 `class` token，去掉桩前缀后必须能在 `panel.module.css` 找到。反向验证：`s.modalTypo` → 红 |
| 3 | `.primaryButton:disabled` 是被覆盖的死声明 | 删掉，并在原处留注释说明禁用态由 `panel.css` 统一承担（特异性 0,2,1） |
| 4 | 首次测到 0 宽/高无兜底 | `frameFromRect` 尺寸无效时返回空对象（断言已加） |
| 5 | `LibraryList` 拼 `${s.captionText} ${s.dangerText}` 而 CSS 已备 `.dangerCaption` | 改用 `.dangerCaption`（与其注释一致） |

另外三条（定位基准其实是槽位容器而非严格对话列、`position: fixed` 的包含块可能被祖先 `transform`
改变、`useEffect` 依赖 `[ref]` 时列节点被替换不重测）记入「已知边界」而不是改代码 —— 它们要么是措辞
问题，要么需要真实浏览器才能判断。

## 已知边界（离线测不了的部分）

- **真实浏览器里的定位行为未验证**：ResizeObserver 回调时机、右栏开合时列 rect 是否立即更新、以及
  `position: fixed` 的包含块是否被祖先的 `transform` / `filter` / `will-change` 改掉 —— 后者会让
  `left: rect.left` 错位（`dsh-better-sidebar` 为此专门做了降级与每帧反平移，我们没有任何保护）。
  这一条要么重启 DSH 用界面确认，要么将来真出问题再处理；**目前它属于"未公开结构依赖"里我们唯一
  沾到的一处**（因为它是浏览器布局规则，不是宿主的结构约定）。
- watch 依赖（`addWatchFile`）无法在单次 build 里验证；只能确认 CSS 内容确实进了产物。

## 待决策

- `base.tsx` 的 `style` 透传口是否还有调用方（审查提出后我没查完）：若无，是死 prop，应删。
- v0.2.4 起记账的两条仍未处理：`lib/*.js` 换行（产物纯 LF、源码 CRLF）；`test-render.mjs` 里几条裸否定
  断言缺"渲染成功"前提。
