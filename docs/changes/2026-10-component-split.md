# 把提示词库拆成独立组件（2026-10）

## 起点

v0.3.1 之后使用者提出：提示词库的接入应该单独做成一个**组件**，实现方式参考 `dsh-ops`，用目录分割把
结构化功能与提示词库分开，便于后续维护。

## dsh-ops 的模式（实测，不是印象）

`dsh-ops` 装在 profile 的 node_modules 里，读它的产物与装载声明可以得到这套模式：

- `cordis.patch.yml` 里 `insert:` 列出**四条装载行**，各自带 `id` / `name`（`dsh-ops/shell`）/ `config`，
  其中两条默认 `disabled: true`；
- 组件入口是**极瘦转发**（`lib/components/shell/index.js` 只有 0.2 KB：`apply(ctx, config)` 直接调
  `applyComponent(ctx, config, 'shell')`）；
- 每个组件还带自己的 `package.json`（name / description / icon）；
- `package.json` 的 `exports` 为每个组件暴露子路径（`./shell`、`./file`…），装载行的 `name` 就写这个；
- 共享实现集中在 `lib/` 根，组件目录只放"入口 + 元数据"。

## 照搬了什么，以及一处硬边界

host 侧**完全照搬**：两条装载行、各自 `config`、可单独 `disabled`，组件入口是瘦转发。

一条边界必须写下来：**client 半边是包级的**（`package.json` 的 `dsh.client` + `exports['./client']`），
一个包只能有一个客户端 bundle，所以 client 侧做不到"两个可独立启停的 client 插件"。要组件级独立，
client 侧必须拆成两个 npm 包 —— 那是"两个插件"，不是"一个组件"，不是这次要的东西。

因此本批的落点是：**host 侧真组件化，client 侧目录与状态组件化**（各组件自己的 store、自己的两条槽位
注册），并在 README 里把这处不对称写明（`lib/library.js` 的 `inject` 是空数组、`lib/structured.js` 是
`['tools']`，这不是写法不一致，是两组件的真实差别）。

## 结构变化

```text
改前（v0.3.1，42 个源文件）              改后（52 个源文件）
src/index.ts        host 入口            src/index.ts                     host 聚合入口
src/client/index.ts client 入口          src/client/index.ts              client 聚合入口
src/host/{tool,build,args,parameters,    src/components/structured/{index.ts,client.ts,
  subagents,config}.ts                     host/,shared/,client/}
src/host/{library,library-upstream}.ts   src/components/library/{index.ts,client.ts,
src/shared/{types,forms,prompt,format,     host/,shared/,client/}
  tokens,templates.ts,templates.json}    src/shared/{slots,send,plugin-context,
src/shared/library.ts                      dsh-client-store.d.ts,ui/}
src/client/{index,store,send,library,    （两组件各自持有一份自己的 shared/ 与 client/）
  plugin-context}.ts
src/client/dsh-client-store.d.ts
src/client/ui/{theme,styles,config,actions,
  clipboard,base,ListEditor,ToolPairEditor,
  CollapsibleSection,Preview,ModalFooter,
  Modal,LibraryModal,LibraryList,Panel,
  Trigger,sections/*}.tsx|ts
```

`src/shared/` 的语义变了：以前是"两个半边共享"，现在是**两个组件共享的那点东西**（槽位注册描述、发送
链路、上下文类型、UI 基元）。两个组件之间**没有** import 关系 —— 检索到的是别人的成品文本，不进构建器，
这一点现在在目录上就是可见的（审查用 `grep` 独立复核过两个方向）。

## 使用者可感知的变更

- 工具栏里仍然是两个按钮（结构化输入任务 / 提示词库），但它们现在来自**两条独立注册**：各自的 store、
  各自的弹窗、各自的 Esc 处理。以前它们挤在同一个条目、共用一个状态树，还得在 store 里做互斥 ——
  那个互斥连同 `StructuredState.library` 字段一起删掉了。**两个弹窗现在可以同时打开**（这是有意的
  设计变更）。
- host 侧多出两个可独立装载的入口：`dsh-plugin-structured-prompt/structured` 与
  `dsh-plugin-structured-prompt/library`。可以单独 `disabled`、单独配置，配置也各归其位
  （`provider` 归结构化、`libraryBaseUrl` 归提示词库 —— 以前它们挤在同一份 `HostPluginConfig` 里）。
- `lib/index.js`（聚合入口）保留：装配两个组件，供"只写一条装载行"的组装与直接调用 `apply` 的测试使用。
  它自己带一份最小的字段分派、未知字段检查，以及一个**只做分派层检查**的 `Config`（字段形状仍由组件的
  `Config` 负责）。

## 契约与不变量

- **黄金样本 25 条逐字未变** —— 本批不碰构建器，`tests/golden/` 未被 `git diff` 触及。
- host 产物从 1 个变 3 个（`index.js` / `structured.js` / `library.js`），**每一个都必须零 import**：
  `tests/verify-install.mjs` 逐个断言（只查一个会把另一个漏掉）。产物格式契约（`__ModuleLoader__.load`
  + 三个共享模块走 require）不变。
- 单文件 ≤ 260 行、client 入口 ≤ 140 行（最长 `host/tool.ts` 259 行，距上限只剩 1 行 —— 下次改它要留意）。
- 注册契约从 2 条变 4 条，断言随之重写：**每条都声明 `store`；同一组件的两条必须共用同一个句柄；两个
  组件用的必须是不同句柄**；此外新增**句柄行为契约**（结构化句柄有 `setForm/setField/addTool`、库句柄有
  `patch/backToList`）—— 只比"句柄相同/不同"抓不到"把库组件的 store 换成结构化的"（那种变异八套全绿）。
- 文档契约跟着改：架构表的槽位行现在必须**恰好四行**（行数 == 注册数），`inject` 断言的比对集合扩到
  四个入口（client 聚合、host 聚合、两个组件入口）。
- 新增**装载行 → `exports` → 产物名**三方一致性断言：只查 patch 文本包含会漏掉"`exports` 被删或指错"，
  那种组合下 DSH 会指向不存在的入口（或装到错的组件），而本机测试全绿。
- 注入样式（`PANEL_CSS`）改用**共享属性** `[data-dsh-prompt-panel]` / `[data-dsh-prompt-trigger]`：两个
  弹窗根与两个按钮各带一个共享属性，样式只认它 —— 将来加第三个组件不必改 CSS。

## 第一轮审查：1 条阻断（真实浏览器实测）

**`PANEL_CSS` 的选择器列表被写坏了**，而它是本批我自己改出来的：我用字符串替换给 13 处选择器补库弹窗那
一份时，把「后代选择器」写成了「逗号分隔的独立选择器列表」——

```css
/* 想写的： */  [data-structured-prompt-modal] textarea, [data-structured-prompt-library] textarea { … }
/* 实际写成：*/ [data-structured-prompt-modal], [data-structured-prompt-library] textarea { … }
```

于是裸的 `[data-structured-prompt-modal]` 变成**无条件命中弹窗根元素**的选择器：滚动条那条的
`width/height: 10px` 让弹窗高度塌成 10px（内联 `modalStyle` 有 width 没有 height，救不回来），禁用按钮
那条的 `opacity: 0.45` 让整棵子树半透明 —— 审查用真实 Chrome + Playwright 实测确认（`rect.height=10`、
`opacity=0.45`），换成 HEAD 版样式则恢复 630px/不透明。而新拆出去的库弹窗**一切正常**，正是"拆分后只在
一边生效"的形态。

关键在于它**八套测试全绿**：`test-render` 只断言几个样式对象常量与 HTML 字符串，不解析 `PANEL_CSS` 的
选择器语义。这次除了修语法，还做了两件事：

1. 修法不只是把选择器写对，而是消除结构性诱因 —— 引入共享属性（见上），CSS 里不再出现任何组件专属属性；
2. 补了两条静态断言：**裸共享属性不许出现在多项选择器列表里**（正好证伪这次的错法）、**所有选择器都
   必须锚在共享属性上**（将来加组件忘了改样式会红），另加两条"两个弹窗根都带共享属性"。

## 采纳（第一轮审查的 6 条需修）

| # | 问题（审查实测） | 处理 |
| --- | --- | --- |
| 1 | 没有断言把「装载行 ↔ `exports` ↔ 产物名」对上：删掉 `exports['./structured']` 或把它指向 `lib/library.js`，八套仍全绿 | `tests/verify-install.mjs` 新增三方一致性断言（含产物文件存在、两条 `name` 都落在 `exports` 的组件入口上） |
| 2 | 注册层无法证伪「库组件绑错 store」（换成结构化 store 后 0 条红） | `tests/test-registration.mjs` 新增**句柄行为契约**断言（按 id 断言各自动作表里该有的动作） |
| 3 | README 称 `lib/structured.js` 也注册路由，实测该产物里 `structured-prompt/library` 出现 0 次 | README 改成"`lib/structured.js` 只注册工具、`lib/library.js` 只注册路由" |
| 4 | 聚合入口不导出 `Config`，README 关于"装载期校验"的说法对单条装载行不成立 | 给聚合入口补一个**只做分派层检查**的 `Config`，README 同步说明 |
| 5 | 归档写"源文件从 36 个变成 52 个"，实际 HEAD 是 42 个；结构对照表漏了 v0.3.x 已有的 6 个文件 | 本文件已修正（42 → 52），对照表补全 |
| 6 | 三处仍写"两个弹窗互斥"，且 `test-render` 那条断言是恒真的 | 两处注释改写；那条断言拆成"检索弹窗只渲染自己的内容"+"**两个组件的开关互不影响**"（后者才有证伪力） |

另有两条建议一并采纳：`store` 里那个没人调用的 `backToList` 现在真的被组件用上了（序号作废仍在组件侧）；
`styles.ts` 的换行统一为 CRLF（与其余源码一致）。

## 第二轮（复审）：一条新发现的盲点

复审确认阻断**真的修好** —— 而且它没有复用仓库里的断言：把两个弹窗的真实 HTML（SSR 产物）塞进 jsdom，
用它的选择器引擎逐条跑 `PANEL_CSS` 并判断 `root.matches(selector)`，结论是两个弹窗各 1 个根元素、
**命中根元素的规则 0 条**；库弹窗侧也没丢样式（后代锚点分别命中 12 / 4 个元素）。6 条需修逐条在工作区
核实落实，8 个突变里 7 个精确变红。

**唯一 0 条红的那一个，问题出在我补的断言自己身上**：`cssGroups` 用 `.filter(text => !text.includes('*'))`
排除注释，而 `PANEL_CSS` 里「弹窗内容区右侧滚动条」那条注释恰好写在唯一含滚动条声明的规则之前 ——
整段被丢掉。于是把裸属性混进**带注释的那一段**（第一轮阻断的原样写法）时这条断言**零红**；混进无注释
的段则正常变红。复审还把机理坐实了：按那个口径分段得 9 段，被 `*` 过滤丢掉的恰好是那一段。

修法是解析前先剥注释（`.replace(/\/\*[\s\S]*?\*\//g, '')`），改完用同一个突变复验 —— 现在会红。

这条值得单独记：**守护断言自己也需要变异验证**。"加了一条断言"与"这条断言守得住"是两件事，只有反着
做一次（把要防的错法放回去）才能区分。本批在这上面连栽两次：先前那两条句柄断言写错了对象
（`store.actions` 在实例上，不在句柄上，加进去就没绿过），这次是解析口径漏了一整段。

复审的另一条建议也采纳了：聚合入口的 `Config` 现在会各调一次组件的 `narrowConfig`，因此
`provider: 42` 走包名装载行与走组件装载行的报错**时机与类型一致**（都是装载期 `ValidationError`），
不再退化成 `apply` 期抛错。

## 尚未验证（需要真实 DSH）

- 两条装载行在真实 DSH 里的装载：`dsh-plugin-structured-prompt/structured` 与 `.../library` 是否都被
  Loader 解析到（要重启 DSH；运行中的实例早于本批产物）。
- client 侧两个组件在**同一个 bundle** 内的共存：同一个槽位有两条注册时，渲染顺序与两个按钮的实际排布
  （`order` 20/21 与 10/11）需要肉眼确认一次；两个弹窗"可同时打开"的实际观感（两层遮罩）也要看一眼。
- 这两条都是"重启后看界面"一分钟能确认的事，但**在本批的自动化范围内无法断言**：离线测试只能断言
  "注册了什么"，不能断言"渲染器怎么排"。而样式那条阻断恰好说明了这个边界的代价 —— 它是由真实浏览器
  发现的，不是测试。

## 审查记录

| 轮次 | 范围 | 结论 |
| --- | --- | --- |
| 第一轮 | 待提交的完整改动（含四个产物） | **1 条阻断 + 6 条需修 + 5 条建议**。阻断是 `PANEL_CSS` 的选择器语义（真实 Chrome 实测：结构化弹窗塌成 10px、半透明），本批自造、八套零红通过；6 条需修见上表；建议里采纳 2 条（死动作、换行）。审查另用变异实验回答了一个关键问题：把装载行的 `name` 改回包名**能**被现有断言抓住（`verify-install` 的两条 name 包含检查），而删/错指 `exports` 抓不住 —— 已补 |
| 第二轮（复审） | 点名的修复项 + 新断言的反向验证 | **无阻断，1 条需修**。修好的地方被独立复核（不复用仓库断言：真实 HTML + jsdom 选择器引擎，见下节）。唯一需修是**我补的那条断言自己有盲点** —— 已修并复验 |

## 评估后决定不做

- **把 client 侧也拆成两个包**：那会变成两个插件，而这次要的是"一个包里的组件"；代价（两份 package.json、
  两次安装、两套构建）与收益（能单独禁用 client 半边）不成比例。
- **让聚合入口与组件入口共享一份 config 分派逻辑**：聚合入口只有十几行，抽象出来反而更难读。
- **给每个组件补 `package.json`（像 dsh-ops 那样）**：`lib/` 是构建产物，往里放手写元数据文件会让
  "产物目录"与"源目录"的边界变模糊；DSH 目前也不需要它。

## 一处流程修正（与代码无关）

本批起，**归档文件名不再绑定版本号**（这份文件从 `v0.4.0.md` 改名为 `2026-10-component-split.md`），
`package.json` 的 `version` 也回退到本批之前的 `0.3.1`。

原因是先前几批我把「提升版本号」当成了流水线的一步：从 `0.2.2` 起每次提交都顺手把 `version` 往上加，
并写进提交信息，维护者没有逐次反对就成了惯例。那是错的 —— **版本号是发布决策，由维护者定**，不该由
每次改动顺手推进；"没被反对"不等于授权。先前几批的归档保持原名不改（它们是历史记录）。以后归档不带
版本号，`version` 只在维护者明确说发版时才动。
## 待决策

- v0.2.4 起记账的两条仍未处理：`lib/*.js` 换行（四个产物纯 LF，源码 CRLF）；`test-render.mjs` 里 3 条
  裸否定断言缺"渲染成功"前提（渲染崩溃时空 HTML 会让它们假通过）。
- `verify-install` 的装载行检查仍是**正则 + 字符串**级别（能挡住"没指向组件入口"，挡不住"两条都指同一个
  子路径"）。要真正严格就得引 YAML 解析 —— 而本仓库刻意零 devDependency，这笔账留在这里。
