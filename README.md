# dsh-plugin-structured-prompt

把 DSH 输入框切换成**结构化提示词表单**的插件，并接一个**公开提示词库**的检索入口。

在输入框底部的「结构化输入任务」，点开即弹出结构化提示词表单。填完后可以点「复制」把成稿取走，或点「发送」把它作为普通用户消息直接投递进当前会话 —— 没有「同步回输入框再编辑」这一步。旁边的「提示词库」按钮检索 prompts.chat 上的公开提示词，选中后预览原文、直接发送：这条路径**不经过构建器**（检索到的是别人的成品文本，不做字段校验）。

```powershell
dsh plugin --profile desktop add github:YuChenLiao/dsh-plugin-structured-prompt
# 重启 DSH 生效（客户端插件的模块图在启动时建立）
```

仓库已包含构建好的 `lib/`，装完即可用；想改源码看下方[开发](#开发)。

## 定位说明

本插件是**提示词构建器**：DSH 的系统提示由主机每步组装，客户端插件没有「仅对单次对话注入 system prompt」的接口，因此产出的提示词以**普通用户消息**的形式投递进当前会话（或复制到剪贴板由你自行处置）。

同一个构建器还以**工具**的形式暴露给模型（见下节），因此"人来填表单"和"模型自己构建"得到的提示词是同一份实现、同一份产物。

本插件有**两条产出路径**，边界是 v0.3.0 定下的：表单与工具走**构建器**（同一份实现、同一份产物，产物由 `tests/golden/` 的 25 条样本逐字锁住）；提示词库检索走**旁路** —— 检索到的是别人写好的成品文本，不做字段校验、不进构建器，只被预览与发送。两条路径共用同一条发送链路（会话作用域的 `conversation.send`），产物互不干涉。

## 功能

- **输入框底部入口**：入口按钮在输入框工具栏里（`conversation.input.left`，与计划/权限控件同一行），点开弹出表单。
- **弹窗表单**：宽度固定（`clamp(600px, 74vw, 900px)`），高度**由内容决定、最多占窗口 70%**（`max-height: 70vh`）——不会占满屏幕；内容超出上限时在弹窗**右侧**出现滚动条（内容区需要 `overflow-y: auto` + `flex: 1 1 auto` + `min-height: 0` 才能正确收缩，`scrollbar-gutter: stable` 避免内容增减时左右跳动）。
- **弹窗分三段**：标题栏（标题 + 必填提示 + 关闭）/ 可滚动内容区（套用模板时的场景条 + 四个分组）/ **底部操作栏**（模板、导入、导出、清空在左，**复制**与**发送**在右）。滚轮只作用于内容区，标题栏与底部操作栏常驻。
- **复制**：把构建好的提示词放进剪贴板（优先 `navigator.clipboard`，非安全上下文时降级到 `execCommand('copy')`），结果在按钮旁短暂提示。
- **发送**：把成稿**直接投递进当前会话**（走会话作用域的 `conversation.send(text)`，消息正文就是成稿），发送后弹窗自动关闭。
- **点遮罩不关闭**：遮罩不绑定点击处理器，避免误触丢失已填内容；关闭只经由标题栏的 `×` 或 Esc。
- **分组不裁剪内容**：分组只用「标题 + 分隔线」，**不用卡片包裹**。卡片带来 `overflow: hidden`，会把需要更多高度的字段裁掉、也截断外层滚动——这正是"表单项展示不全"的根因。任何层级都不设 `max-height` 去限制字段。
- **`min-height: 0` 只属于滚动容器**：分组容器**不写** `min-height`，保留默认的 `min-height: auto` 让它按内容撑高；若误写在分组上，分组会被压缩到内容高度以下、子元素互相压叠（症状是分组标题与上一个字段的输入框重叠）。这条与上一条一样由渲染测试直接断言。
- **表单字段不限高**：多行文本域不写死行数，高度随内容自适应（`field-sizing: content`，不支持的浏览器由首挂载与 `onChange` 时的 JS 兜底）。
- **四组、默认只展开基础信息**：基础信息展开，约束与规则 / 工具策略 / 输出与兜底默认折叠，展开哪组只看哪组。
- **工具策略自动或手动**：
  - **自动**：交给模型自行判断，提示词里只写一句「由你根据任务需要自行判断并选择要调用的工具；不需要工具时直接回答。」
  - **手动**：由你**直接填写**要允许调用的工具名（可加一行用途），提示词生成「只允许调用下列已指定的工具，其余工具一律不要使用」+ 逐行清单。工具名与用途按原始索引配对：用途可留空（只写工具名），工具名留空的行整体忽略。
  - 刻意**不提供**「从已安装清单里勾选」：DSH 的插件清单列的是自带插件而非用户安装的插件，skills 清单也不属于本插件的职责；工具检索在输入框的 `/` 菜单里。本插件因此**不读 `remote.<namespace>`、也不读插件与 skills 清单**，`inject` 只有 `slots`（唯一触到主机的动作是发送链路：会话作用域上的 `conversation.send`）。
- **填完即走**：要么点「复制」把成稿拿去别处用，要么点「发送」直接投递进当前会话。没有中间态。
- **实时预览与预算**：表单底部可展开查看完整提示词；折叠标题给出字数与**估算 token**，展开后列出**逐段占用**（哪一段最吃上下文），便于发送前判断会不会太长。token 是估算（CJK 每字 1、其余每 4 字符 1），只用于判断量级。
- **模板与导入导出**：内置八套模板 —— 4 套**任务形态**（探索调研、实现改动、故障定位、交接归档）与 4 套**领域样例**（告警研判（原始示例）、代码审查、数据提取、报告撰写）。模板数据是 `src/shared/templates.json`：表单下拉、工具的 `template` 枚举、黄金样本都从它取值，改模板不必碰代码。**下拉选项里带每套模板的一句话场景**；套用后表单顶部出现一条场景条，提醒把本次的具体任务写进「目标」—— 模板带的是形态化目标，不复述具体任务时产物会变泛。场景条是**界面陈述**：它由 store 里的 `appliedTemplate` 驱动，**不参与提示词构建**（成稿只由表单字段决定，改这个标记不会改产物一个字节）。同一会话内手改字段与关闭重开都不会清掉它，只有「清空」与「导入」会清本会话的标记 —— 注意表单状态本就按会话独立（store 实例按会话分开），切到别的会话看到的是那个会话自己的表单，自然也没有这条场景条；记的 id 解析不到时（例如来自已删除的模板）整条不渲染 —— 界面不声称一个说不出来源的来源。表单可导出为 JSON、从 JSON 导入，便于跨会话复用。导出文档带 **schema 版本号**；导入时只接受已知字段并逐字段校验形状 —— 未知键、类型不符、越界枚举会被丢弃并在界面上说明，旧版无版本号的文件仍可读。
- **提示词库检索（prompts.chat）**：输入框底部第二个入口，「检索 → 预览 → 发送」。**这条路径不经过构建器**：检索到的是别人写好的成品文本，既不做字段校验、也不填进表单，发送的就是那段原文（界面写明「未经本插件整理」，按钮文案是「发送原始提示词」）。检索只按**标题**匹配；选中一条后再单独取全文，所以列表页不会把一屏全文带进来。留空查询则列出上游最新的一批 —— 注意那条路径走的是上游的**列表**端点，它每条都带全文，宿主取回后立即丢弃（只留标题、描述、作者与 id），因此那次响应本身并不小。发送走的是与表单成稿**同一条**链路（会话作用域的 `conversation.send`）。
- **提示词库的请求由宿主代发**：上游不返回 CORS 头（预检返 204 却不回 `Access-Control-Allow-Origin`），浏览器直连会被拒。所以浏览器请求的是宿主注册的两条**同源**路由 —— `/api/structured-prompt/library`（检索）与 `/api/structured-prompt/library/item`（取全文），由宿主用全局 `fetch` 去取上游。副作用是好的：上游地址成了宿主侧配置（`config.libraryBaseUrl`，缺省 `https://prompts.chat`），要指向自托管实例只改配置、插件代码不动。三条边界由断言守着：基础地址**只来自配置**（不接受请求参数，否则这条路由就是任意 URL 代理）、记录 id 先校验再拼进上游路径（挡路径注入）、不向上游转发任何浏览器请求头。上游失败被归一成可读说明而不是把异常抛给浏览器：超时 → 504，网络错 → 502，上游 404 → 404（「记录没了」，只有取全文那条路会这样判），其余非 2xx → 502。
- **跟随主题**：颜色与阴影全部走 DSH 主题 token（`--dsw-alias-*`、`--dsw-elevation-prominent`），深浅色主题自动切换。

## 表单项（17 项）

| 组 | 字段 | 必填 |
| --- | --- | --- |
| 基础信息 | 身份 / 目标 | 是 |
| 基础信息 | 背景与上下文 / 成功标准 | 否 |
| 约束与规则 | 硬性规则（逐条增删改序）/ 禁止行为（逐条） | 否 |
| 工具策略 | 调用工具策略（自动 / 手动 / 不指定） | 否 |
| 工具策略 | 可调用的工具（手动时：工具名 + 用途，配对填写） | 否 |
| 工具策略 | 工具使用策略（逐条）/ 工具失败时的处理 | 否 |
| 输出与兜底 | 输出格式类型（JSON / Markdown / 表格 / 纯文本） | 否 |
| 输出与兜底 | 输出格式说明 / 字段级说明（逐条）/ 语言与语气 | 否 |
| 输出与兜底 | 数据不足时的行为 / 少样本示例 | 否 |

### 生成的提示词结构

段落顺序与格式与插件自带的原始实现一致，扩写字段都并入既有段落，没有新增顶层段落：

```text
# 身份                     ← 身份 + 背景与上下文
# 目标                     ← 目标 + 完成标准
# 硬性规则（必须遵守，优先于其他任何要求）   ← 逐条编号 + 禁止行为子块
# 工具使用策略             ← 策略引导语（自动）/ 点名工具清单（手动）+ 逐条策略 + 工具失败时
# 输出格式                 ← 格式说明（自定义优先，否则用所选格式的骨架）+ 字段说明 + 表达要求
# 数据不足时
# 示例
```

空段落整体省略，非空段落之间以单个空行连接。

「格式说明」是**自定义优先、否则由格式类型生成骨架**的二选一 —— 说明字段才是最终契约，
格式类型只是帮它填骨架。选格式类型时 `applyFormatChoice` 会同步更新说明里的骨架部分：
说明为空就整段填入；已在某套骨架基础上追加过内容就**只换骨架、保留追加**；完全手写的
说明不动。当说明与所选格式类型**完全无关**时（例如手写了一段 TOML 契约），界面会明确提示
「格式类型已不生效」，避免高亮的格式类型与实际产物静默分叉。这条规则由
`tests/test-prompt.mjs` 逐状态覆盖。

## 模型可调用的工具

host 半边注册一个工具 `build_structured_prompt`，让模型自己把模糊的委托变成精确提示词：

```
模型 → build_structured_prompt({ role, goal, rules: [...], output_format: 'json' })
     → 返回构建好的提示词
     → 模型把它作为 subagent 工具的 prompt 参数（或写进文件、用在自己身上）

模型 → build_structured_prompt({ role, goal, delegate: { label: 'review' } })
     → 构建后**直接投给子代理**（前台运行、收集结果、释放运行）
     → 提示词不进入主上下文，只回传子代理的输出
```

| 项 | 说明 |
| --- | --- |
| 必填 | `role`（身份）、`goal`（目标）—— 与表单同一条规则；**用 `template` 时这两项可以省略**，内置模板都带它们 |
| 可选 | 表单其余字段（`background` / `rules` / `forbidden` / `tool_policy` / `output_format` / `fallback` …） |
| 模板 | `template` 按任务形态选一套内置模板作默认值（schema 里带每套的一句话场景），调用参数覆盖它 |
| 直投 | `delegate: { label?, provider? }` 把提示词直接交给子代理执行，不进入本上下文 |
| 返回 | `{ prompt, template, missing, delegated, delegation }`，模型看到的正文就是 `prompt`（或委托时的子代理输出）。`delegation` 非空表示**确实发生了委托**（形如 `spawn/child-1 (completed)`），未委托时为空串 —— 子代理正常完成但没有文本输出时 `delegated` 合法为空串，只能靠它区分「静默的子代理」与「没委托」 |

几个刻意的取舍：

- **`delegate` 走可选服务，不进 `inject`**。`ctx.get('subagents')` 缺失时，`delegate` 报错并指出"不带它调用即可拿到提示词" —— 把可选能力写成硬依赖，会让本插件在没装配子代理 provider 的组装里**整个不激活**。
- **模板可以替模型带上身份与目标**：`role`/`goal` 通常必填，但只要传了 `template`，缺省或空白的那一项就由模板提供（构建时它们走「调用参数优先、未给用模板底座」）。这不是放松约束，而是让「只填任务特有的字段」真的能发生 —— 参数边界原来强制两者非空，模板永远补不进来，实测 10 次真实调用里有 2 次正是因为漏传 `role` 直接失败。放宽的只是「缺失/空白」，类型错误照旧必报；不带模板时缺 `role` 会报错，错误信息里指出可以用模板。
- **provider 的默认值来自装载行的 `config`**，代码里不留可配置的假象：不写 `config` 时，只注册一个 provider 就用它，多个时用 `spawn`（存在时）、否则取第一个 —— DSH 的 base bundle 同时注册 `spawn` 与 `fork`，要求调用方显式指定等于让功能开箱不可用，而 `fork` 会继承父会话上下文、语义与「独立委托」相反。要用别的默认就在 `cordis.patch.yml` 里**结构化组件那条装载行**写 `config: { provider: 'fork' }`；调用参数 `delegate.provider` 优先于它（空串与纯空白算「未给」，不会顶掉配置）。只有显式传了未注册的名字才报错并列出候选；一个都没有则明确拒绝。
- **配置形状由导出的 `Config` 在装载期校验**：两个组件各有自己的 `Config`，聚合入口另有一个**只做分派层检查**的 `Config`（是不是对象、有没有不认识的字段），字段形状仍交给组件（结构化只认 `provider`、提示词库只认 `libraryBaseUrl`），把对方的字段写进某一条装载行会在装载期报"不支持的字段"。`config` 不是对象、含不支持的字段、或 `provider` 不是（写空的）字符串时，cordis 抛 `ValidationError` 并列出问题，`apply` 根本不会被调用 —— 静默忽略会让"profile 里写着 `fork`、实际用着 `spawn`"成为最难定位的那类失效。`Config` 是**手写**的 standard-schema 对象（不 import 校验库，见下节），判定与 `src/components/structured/host/config.ts` 的 `narrowConfig` 同源。两点边界：`provider` 名**是否已注册**要到第一次 `delegate` 才校验（装载期还不知道子代理 provider 注册了什么）；`provider` 必须写在 `config:` 之下，写错层级会被 loader 原样保留、不报错。
- **前台 run 的收尾照官方实现**：结果与 `dispose()` 并行 settle，两者都失败时抛 `AggregateError`，避免清理失败掩盖真正的执行失败；非 `completed` 的终态一律算失败，但会带上诊断与部分输出。
- **空串（含纯空白）、空数组、全空白条目都算「未给」**。用模板时传 `rules: []` 或 `rules: ['']` 的意图是"没额外要求"，而不是"删掉模板的规则"。
- **`callable_tools` 收一个数组**，每项写成 `工具名` 或 `工具名：用途`，由工具拆成表单那两个按索引配对的数组。
- **`output_spec` 一旦给出就原样使用**，`output_format` 不改写它；只有 `output_spec` 未给时，`output_format` 才用于更新**模板底座**的说明（走 `applyFormatChoice`：底座为空或恰为某套骨架则整段填入，底座为「骨架 + 追加」则只换骨架、保留追加）。表单里点选格式走的是同一个函数，因此「模板 + 指定另一套格式」这类状态在两个入口逐字一致（由 `tests/golden/tool-*` 样本守住）。
- **调用卡片只提供 `presentCall`**（用本次目标作标题）。结果是整段提示词，再写 `presentResult` 只会把同一段大文本塞进视图载荷 —— DSH 的 `run_code` 工具也是这个取舍。

> 一致性由 `tests/test-tool.mjs` 守住：同一组字段经工具与经表单产出必须**逐字相同**。将来若有人在工具里另写一套拼装，测试会失败。

### 为什么工具定义是手写的，而不是用 `defineTool`

`@deepseek-ai/dsh-tools`（提供 `defineTool`）**只能从 profile 的 node_modules 解析**。而
`link:` 安装下插件经 junction 加载，ESM 会 **realpath** 到源码目录，向上找不到任何
`node_modules`：

```
从 profile 的 junction 位置 import '@deepseek-ai/dsh-tools'  → OK
从源码目录 import '@deepseek-ai/dsh-tools'                    → ERR_MODULE_NOT_FOUND
```

后果很隐蔽：模块加载失败 → 插件 fiber 停在**未激活**状态 → 工具不注册。当时的表现是
**不报错**（巡检里表现为条目 `enabled: true` 但 `fiberPhase: null`，相邻插件都是
`"active"`），只能靠逐条比对定位；当前的 profile 启动会做最终审计（`assertEntriesActivated`：
条目没进 `active` 就带上名字与原因抛错），同类问题会更响。
`github:` 安装不会触发，因为包真实位于 profile 的 `node_modules` 下。

所以 host 半边按 `ToolDefinition` 契约**手工构造**定义，**产物零 import**，与 client 半边
「本地类型声明、不引入其包」的做法一致。代价是参数校验要自己写（`src/components/structured/host/args.ts` 的
`narrowArgs`）：不合规时**报错**而不是静默丢弃，失败说明会回到模型手里。配置校验也由此
自己承担（`src/components/structured/host/config.ts`）：导出的 `Config` 是手写的 standard-schema 对象，判定逻辑
与 `narrowConfig` 同源，因此既能被 cordis 在装载期统一校验，又不引入任何运行时 import。

`tests/verify-install.mjs` 断言 host 产物不含静态 `import`、动态 `import(` 与 `require(`，防止这个约束被无意打破。

## 来源与致谢

插件本身与它检索的提示词库是两回事，这里把关系与许可写清楚（依据是上游仓库的 `LICENSE` 文件，核对于 2026-10）：

| 对象 | 是什么 | 许可 |
| --- | --- | --- |
| 本插件 | DSH 的结构化提示词构建器 + 提示词库检索入口 | MIT（本仓库） |
| [prompts.chat](https://prompts.chat)（[仓库](https://github.com/f/prompts.chat)，原 *Awesome ChatGPT Prompts*） | 本插件检索的社区提示词库，社区维护、可自托管 | **双许可**：源码与站点自产内容 MIT；**提示词内容与数据 CC0 1.0**（公有领域） |

本插件**只调用它的公开只读 HTTP 接口**（`GET /api/prompts/search`、`GET /api/prompts`、`GET /api/prompts/{id}`），
不包含、不打包、也不分发它的任何代码或提示词数据 —— 所以上游的 MIT 条款对本插件没有附加要求，检索到的
提示词内容属 CC0（可自由使用，无归属义务）。即便如此，这仍然该写下来并致谢：

- 感谢 [f/prompts.chat](https://github.com/f/prompts.chat) 的作者与社区贡献者：把这个提示词库做成公开、
  免费、可自托管，还提供一套不需要 API key 的只读接口 —— 没有这些，这个入口无从谈起。
- 界面上的来源标注跟着响应走（默认 `prompts.chat`，自托管时是你的实例域名），而**检索结果不经本插件
  的任何规范化处理**直接预览与发送：原文的著作权与许可仍归各自的贡献者。
- 默认地址 `https://prompts.chat` 是第三方服务；要换成自托管实例，写**提示词库组件那条装载行**的
  `config.libraryBaseUrl` 即可（见下文）。

## 安装

### 从 GitHub 安装（推荐）

```powershell
dsh plugin --profile desktop add github:YuChenLiao/dsh-plugin-structured-prompt
```

`dsh plugin add` 会登记依赖并把它加入 `dsh.profile.bundles`。仓库里已包含构建好的 `lib/`，因此**装完重启 DSH 即可**，不需要自己构建。

### 本地开发安装

```powershell
git clone https://github.com/YuChenLiao/dsh-plugin-structured-prompt.git
cd dsh-plugin-structured-prompt
dsh plugin --profile desktop add link:$PWD
```

链接方式下**改动 `src/` 后需要重新构建产物**才生效（见下方[开发](#开发)）。

### 两种方式可以自由切换

```powershell
dsh plugin --profile desktop remove dsh-plugin-structured-prompt
dsh plugin --profile desktop add github:YuChenLiao/dsh-plugin-structured-prompt
```

本插件的包目录**不含 `node_modules`**（开发期依赖放在 `.dev-deps/`，见 [开发](#开发)），所以在 `link:` 与 `github:` 之间来回切换不会再踩到 pnpm 重建符号链接失败的问题。

### 为什么"装完要重启"而不是"改了配置文件"

插件的装载行**不在 `cordis.yml` 里**。那个文件是**空的根**，全部内容就是：

```yaml
# The tree is composed as patches: each bundle in package.json's dsh.profile.bundles,
# then cordis.patch.yml, then any --patch overlays. Edit cordis.patch.yml, not this file.
[]
```

真正的装载树是 **DSH 启动时合成**的：按 `package.json` 的 `dsh.profile.bundles` 顺序叠加各 bundle，再叠加各 bundle 自带的 `cordis.patch.yml`（本插件的挂载声明就在那里）。

因此：**安装、切换、卸载后都需要重启 DSH**；想在不重启的情况下查看合成结果，用：

```powershell
dsh --profile desktop --dump-config
```

## 开发

源码是 TypeScript（`.ts` / `.tsx`），构建与类型检查都复用 **DSH 源码树**里已安装的
工具（tsdown / typescript / tsx / react 类型）—— 本插件自身**没有 devDependency**，
也不执行 `npm install`。因此需要先把 DSH 源码仓库放在手边：

```powershell
git clone https://github.com/deepseek-ai/deepseek-harness.git
$env:DSH_SOURCE_ROOT = "<上一步克隆出来的目录>"   # 默认按 D:\dsh\deepseek-harness 查找
```

然后：

```powershell
# 1) 准备开发期依赖（幂等，只需一次）
#    react / react-dom（测试与组件必须是同一实例）、@types/react（类型检查）、
#    链接建在 .dev-deps/，**不是 node_modules** —— 理由见下方「为什么不用 node_modules」
node tools/setup-dev-links.mjs

# 2) 构建产物 lib/index.js（host）与 lib/client.js（浏览器）
node tools/lib/build.mjs

# 3) 全部验证（八套）：类型检查 + 提示词行为 + 黄金文件 + 文档契约
#    + 注册契约 + 渲染结构 + 工具行为 + 安装产物
node tools/run-tests.mjs
```

### 改动流程（顺序不能换）

1. 改 `src/` 后先 `node tools/lib/build.mjs` —— `lib/` 是入库产物，安装方加载的正是它。
2. 跑 `node tools/run-tests.mjs`，八套全绿。
3. **独立审查必须在 `git push` 之前完成**，审查对象是**待提交的完整改动（含 `lib/` 产物）**，不是提交历史里的某个点。审查结论要与本批归档一起入库，让"审没审、审了什么"事后可核对。
4. 按审查意见修完，再对**受影响的文件**审一遍：本仓库真实发生过「修复本身引入回归」（v0.2.1 的 `{form:{...}}` 从硬失败变静默清空），所以"修完即完"是错的。
5. 改了提示词产出就更新 `tests/golden/`（`--update`）并**人工打开生成的文件核对**。
6. 归档：`docs/changes/<版本>.md` 写清行为变更、契约影响、`## 审查记录`（轮次 / 范围 / 结论）与「评估后决定不做」的方案。
7. 分阶段提交，提交信息说明"为什么"；tag 与 release 只在归档已入库后打。

### 为什么不用 node_modules

本工程是一个 DSH 插件包，使用者会用 `dsh plugin add link:<本目录>` 或
`add github:...` 安装它。**包目录里一旦出现 `node_modules`，pnpm 会把它的内容
纳入该包的快照** —— 之后改用 `github:` 安装时，pnpm 会试图重建其中的符号链接，
在 Windows 上以 `ERR_PNPM_EPERM` 失败，并把已装好的插件留成"已卸载"状态
（依赖被移除、`bundles` 里也没有了）。

所以开发期依赖一律放在 `node_modules` 之外的 `.dev-deps/`：

| 用途 | 通道 |
| --- | --- |
| 类型检查 | `tsconfig.json` 的 `paths` 把 `react` / `react/jsx-runtime` 指向 `.dev-deps/@types-react` |
| 测试运行 | `tools/lib/loader-hook.mjs` 把 `react` / `react-dom`（含 `jsx-runtime`、`server` 子路径）重定向到 `.dev-deps/`，并把 `@deepseek-ai/dsh-client-store` 指向本地桩 `store-stub.mjs` |
| 版本控制 | `.gitignore` 排除该目录 |

`tools/setup-dev-links.mjs` 还会顺手清掉历史遗留的 `node_modules/`。安装产物校验
（`tests/verify-install.mjs`）也断言了"本工作区无 node_modules"。

单跑某一套（`tsx` 提供 TS/TSX 转译，`TSX_TSCONFIG_PATH` 让 `jsx: react-jsx` 生效，
`loader-hook` 负责依赖桩与 `.js`→`.ts` 说明符映射）：

```powershell
$env:TSX_TSCONFIG_PATH = "$PWD\tsconfig.json"
node --import file:///D:/dsh/deepseek-harness/node_modules/tsx/dist/loader.mjs `
     --import ./tools/lib/loader-hook.mjs tests/test-render.mjs
```

### 代码结构

单文件不超过 **260 行**、客户端入口不超过 **140 行**（都由 `tests/verify-install.mjs` 断言），入口只做装配：

```text
src/index.ts                          host 聚合入口：装配两个组件（单条装载行的写法）
src/client/index.ts                   client 聚合入口：槽位注册 + 样式注入（无 UI 实现）
src/components/                       两个组件各自成目录（形态参考 dsh-ops）
  structured/                         结构化提示词：表单 + 模型可调用的工具
    index.ts                          组件 host 入口：inject(['tools']) / Config / apply
    client.ts                         组件 client 入口：两条槽位注册（入口 + 弹窗）
    host/
      tool.ts                         工具定义（schema + 行为 + 卡片）
      build.ts                        纯构建：已收窄的参数 → 表单 → 提示词
      args.ts                         参数收窄 / 校验 / 默认值回退
      parameters.ts                   参数与输出 schema（标准 JSON Schema）
      subagents.ts                    直投子代理：provider 选择 + 前台 run 的收尾
      config.ts                       装载行配置（只认 provider）与 Config schema
    shared/                           与 client 半边共用的纯逻辑
      types.ts                        表单与组件状态类型
      forms.ts                        空白表单、片段补全、导出/导入的版本化文档
      prompt.ts                       提示词分段与组装（段落顺序是契约）
      format.ts                       输出格式语义：骨架表、切换、遮蔽判定
      tokens.ts                       token 粗略估算（预算提示用）
      templates.ts                    模板库的加载、形状校验与 id 解析
      templates.json                  模板数据：单一真源，表单下拉 / 工具枚举 / 黄金样本都取自它
    client/
      store.ts                        会话状态（defineStore 动作表）
      actions.ts                      组件侧的动作类型（打断循环引用）
      ui/
        config.ts                     分组与逐条字段的元数据
        CollapsibleSection.tsx        可折叠分组容器
        ListEditor.tsx                逐条增删改序
        ToolPairEditor.tsx            工具名 ↔ 用途配对编辑
        Preview.tsx                   提示词预览
        ModalFooter.tsx               底部操作栏
        Modal.tsx                     弹窗三段结构
        Panel.tsx                     conversation.input.dock 占用者（表单弹窗）
        Trigger.tsx                   conversation.input.left 占用者（入口按钮）
        sections/                     四个分组各自的字段
          BasicSection.tsx  RulesSection.tsx  ToolsSection.tsx  OutputSection.tsx
  library/                            提示词库：检索 prompts.chat，宿主代发
    index.ts                          组件 host 入口：无硬依赖 / Config / apply
    client.ts                         组件 client 入口：两条槽位注册
    host/
      library.ts                      同源路由：路径 / 方法 / 失败归一，两条只读 GET
      library-upstream.ts             上游请求与响应工具（fetch 可注入，便于离线断言）
      config.ts                       装载行配置（只认 libraryBaseUrl）与 Config schema
    shared/
      library.ts                      类型、常量与上游响应映射（与表单无耦合）
    client/
      store.ts                        检索弹窗自己的会话状态
      actions.ts                      组件侧的动作类型
      library.ts                      检索客户端（只认识同源路径，不认识上游地址）
      ui/
        LibraryModal.tsx              弹窗（外壳 / 原文预览 / 请求副作用）
        LibraryList.tsx               列表视图（搜索行 + 状态行 + 结果列表）
        Panel.tsx                     conversation.input.dock 占用者（检索弹窗）
        Trigger.tsx                   conversation.input.left 占用者（入口按钮）
src/shared/                           两个组件共用的部分
  slots.ts                            槽位注册描述（两个组件的注册清单共用它）
  send.ts                             把内容发进会话（会话作用域的 conversation.send）
  plugin-context.ts                   消费到的 Cordis 上下文形态（本地声明，不引入宿主包）
  dsh-client-store.d.ts               DSH store 的本地类型声明（不引入其包）
  ui/
    theme.ts                          颜色 token 与文本域尺寸
    styles.ts                         样式对象 + 三条布局不变量 + PANEL_CSS
    base.tsx                          TextArea / TextInput / Field / SmallButton / ChipGroup
    clipboard.ts                      剪贴板写入（含 execCommand 降级）
tools/
  lib/build.mjs                       构建脚本（tsdown，三个 host 入口 + 一个 client 产物）
  lib/loader-hook.mjs                 测试用重定向（react / react-dom / 依赖桩）+ .js→.ts 映射
  lib/store-stub.mjs                  defineStore 的离线实现
  setup-dev-links.mjs                 开发态依赖链接（.dev-deps/）
  run-tests.mjs                       八套验证的统一入口
tests/                                 test-prompt / test-golden / test-document / test-tool
                                       / test-registration / test-render / verify-install
  golden/                             提示词格式的契约样本（cases.mjs + 每个用例的 .txt）
docs/changes/                         每个批次的归档：行为变更、契约影响、以及「评估后决定不做」的方案
```

`src/shared/` 是**两个组件共用的那部分**（槽位注册描述、发送链路、上下文类型、UI 基元）：结构化组件与提示词库组件各自完整，谁也不 import 谁 —— 检索到的是别人的成品文本，不进构建器，这一点在目录上就是可见的。而每个组件内部的 `shared/` 是**该组件两个半边的交汇点**：客户端表单与模型工具都调用同一份 `buildSystemPrompt`，所以两种入口产出的提示词必然一致（`tests/test-tool.mjs` 会逐字比对）。

`tests/test-document.mjs` 守两类文档契约：导出/导入的 JSON 文档，以及本 README 里能机器
核对的硬事实（表项数量、行数上限、分组与模板数量、槽位键与架构表、工具返回形状、工具名、
`inject` 声明、依赖清单、仓库地址、文件清单、验证套清单、构建脚本路径）。改实现时漏改
README，那套会先红。

### 槽位注册契约（注册测试守住的那条线）

`useStore` / `actions` **不是**槽位标准 props。渲染器只在注册声明了 `store` 座位时才注入它们：

```ts
ctx.slots.register({ name, id, order, store }, Component)   // 组件里才有 props.useStore / props.actions
```

漏声明 `store` → 组件拿到 `undefined` → 渲染时抛错 → 条目被隔离失效（表现就是"按钮不见了"，且槽位检查里该条目 `active: false`）。这条契约渲染测试抓不到（渲染测试直接给组件喂 `useStore`），因此单独由 `tests/test-registration.mjs` 在注册层断言：**四条注册都声明了 `store`；同一组件的两条共用同一个句柄；两个组件用的必须是不同句柄**（前两条保证入口能驱动自己的弹窗，第三条保证两个组件的状态不耦合——那正是这次拆分的理由）。

### 产物契约

`lib/client.js` 必须保持 DSH 动态客户端 bundle 的格式：

```js
window.__ModuleLoader__.load({ id: 'dsh-plugin-structured-prompt', factory: require => { ... } })
```

- `react` 与 `@deepseek-ai/dsh-client-store` 走注入的 `require`（模块表提供），其余依赖内联；
- host 侧有**三个**产物：`lib/index.js`（聚合入口）、`lib/structured.js`、`lib/library.js`（两个组件入口）。三者各自内联自己的实现，因此**每一个都必须零 import**（见「为什么工具定义是手写的」）—— `tests/verify-install.mjs` 逐个断言，只查一个会把另一个漏掉。`lib/structured.js` 只注册模型可调用的工具 `build_structured_prompt`（`inject: ['tools']`）；`lib/library.js` 只注册提示词库的两条路由（`inject: []`），用的是全局 `fetch` 与 `Response`，这条网络能力因此没有破坏自包含约束 —— 路由**不在** `lib/structured.js` 里，两个组件的产物边界由 `tests/verify-install.mjs` 与工具套逐个核对。
- **提示词库的路由走可选服务**：`ctx.get('connection')`，**不写进 `inject`**（`lib/library.js` 的 `inject` 是空数组）。理由与 `delegate` 走 `ctx.get('subagents')` 相同 —— 没有 web 载体的组装里，本插件仍要能提供"构建提示词"的能力；把可选能力写成硬依赖会让整个组件在那些组装里不激活。没有 `connection`（或没有 `effect` 面，无法保证释放）时只跳过路由注册，其余能力不变。

## 架构

本插件由**两个组件**组成，各自带 host 与 client 半边：

| 组件 | host 半边 | client 半边 | 装载行（`cordis.patch.yml`） | config |
| --- | --- | --- | --- | --- |
| 结构化提示词 | 工具 `build_structured_prompt`（`inject: ['tools']`） | 表单入口 + 表单弹窗 | `dsh-plugin-structured-prompt/structured` | `provider` |
| 提示词库 | 两条同源只读路由（`inject: []`） | 库入口 + 检索弹窗 | `dsh-plugin-structured-prompt/library` | `libraryBaseUrl` |

组件形态参考 dsh-ops：一个包、**多条装载行**，每条有自己的 id、`config` 与 `disabled`，所以两个组件能单独开关、单独配置。`lib/index.js`（聚合入口）把两者一次装完，供"只写一条装载行"的组装使用。

槽位注册因此是**四条**：

| 槽位 | 组件 | 职责 |
| --- | --- | --- |
| `conversation.input.left`（list） | `structured/client/ui/Trigger.tsx` | 工具栏里的「结构化输入任务」按钮 |
| `conversation.input.dock`（list） | `structured/client/ui/Panel.tsx` | 表单弹窗（未打开时不占空间） |
| `conversation.input.left`（list） | `library/client/ui/Trigger.tsx` | 工具栏里的「提示词库」按钮 |
| `conversation.input.dock`（list） | `library/client/ui/Panel.tsx` | 检索弹窗（未打开时不占空间） |

四条注册都不可省略 `store` 座位（见上文[槽位注册契约](#槽位注册契约注册测试守住的那条线)），否则组件拿不到 `useStore` 会直接崩溃失效。声明后渲染器按「handle × sessionId」共享同一实例，所以入口的 `open()` 会直接驱动自己的弹窗重渲染——不需要任何跨注册的状态同步，也**不需要两个组件之间同步**：它们互不干涉（拆分前它们挤在同一个条目里、共用一个状态树，两个开关还得互斥）。

模块划分见上文[代码结构](#代码结构)；数据流是单向的，两个组件各一条：

```text
structured/client/store.ts ──► ui/Panel.tsx ──► ui/Modal.tsx ──► ui/sections/* ──► shared/ui/base.tsx
                                 │      │           │
                                 │      │           └──► ui/ModalFooter.tsx（模板 / 导入导出 / 复制发送）
                                 │      └──► ui/Trigger.tsx（同一 store 的另一处读写）
                                 └──► format.ts（纯函数）◄── PromptForm ── ui/sections/OutputSection.tsx

library/client/store.ts ──► ui/Panel.tsx ──► ui/LibraryModal.tsx ──► client/library.ts
                              └──► ui/Trigger.tsx                        └──►（同源路由 → 宿主代发）
```

提示词库那条支线**不在构建器上**：`library/shared/library.ts` 与表单类型没有耦合，检索到的原文既不进 `PromptForm`、也不经 `buildSystemPrompt`，因此黄金样本（25 条）与它无关 —— 这正是"检索结果不走规范检测"在代码结构上的落点。

### 为什么不用另外两个候选挂载点

DSH 里"接管输入框"看起来有两个更直接的位置，但都不能满足"点击后才接管"：

| 候选 | 机制 | 为什么不用 |
| --- | --- | --- |
| `conversation.composer`（chain） | 每个入口提供一个纯 `select(owner)`，第一个返回非 null 的接管 | `select` 只在**槽位重渲染**时重新执行。store 更新不会触发槽位重渲染（只有 session 源/props 变化才会，例如 `pendingInteraction`），所以点击后 `select` 不会被重新评估，表单永远不出现 |
| `conversation.composer.bar`（single） | 同 cell 中最低 `priority` 的条目渲染（遮蔽） | 遮蔽是**静态**的：一旦注册就固定获胜，无法"仅在开启时"遮蔽 InputBar；而未开启时若由本插件获胜，输入框就消失了（本插件渲染 null 也不会回落到 InputBar） |

链的 `overlay: true`（`conversation.composer` 的实际渲染参数）会让 fallback 即 InputBar 保持挂载、仅被隐藏，草稿与编辑器状态因此不会在切换中丢失。

## 为什么不用清单选择（一段被删掉的设计）

本插件最初提供「手动模式下从 DSH 已安装清单里勾选 skills / 插件」，后来**整块删掉**了，原因值得记下：

- `pluginInventory` 列的是 **DSH 自带插件**（Loader 条目），不是用户安装的插件 —— 用它当"要调用的工具"候选，语义是错的；
- skills 清单是**输入框 `/` 菜单**的职责（`ui-skill` 注册了 `'/'` 触发源），表单再做一个检索入口既重复又不符合 DSH 的设计思路。

所以手动策略改为**由用户直接填写工具名**。副作用是整个插件不再需要 `remote`，也不再有 RPC、命名空间探测与失败态 UI —— `inject` 缩到只有 `slots`。

顺带记一个踩过的坑：Remote 命名空间是**独立注册的 Cordis 服务**，服务键为 `remote.<namespace>`（`api/gateway` 的 `remoteServiceKey`），不是 `remote` 实例上的属性。写成 `ctx.get('remote').skills` 只能拿到 `ClientRemoteService` 的类字段（`ctx, name, namespaces, …`），永远读不到数据。将来若再引入 Remote 读取，务必走 `ctx.remote.<namespace>` 或 `ctx.get('remote.<namespace>')`。

## 排查

- **看不到入口**：确认已重启 DSH。浏览器控制台里 `ClientModuleSystem` 的加载失败会指向本插件的 `lib/client.js`。入口只在有当前会话时可用（没有会话时按钮禁用）。
- **点了按钮没反应**：检查控制台是否有渲染异常；两个组件的判定与渲染都由共享 store 的 `useStore` 驱动，正常路径下点击即弹出表单。
- **弹窗高于预期**：高度上限是 `70vh`，实际高度由内容决定。展开越多分组越高；超过上限后改为内容区滚动，这属于预期行为。
- **提示词库检索失败**：界面直接显示宿主的说明（超时 / 上游状态码 / 网络不可达）。上游是公网服务，断网或它本身不可用时就是这样；把 `config.libraryBaseUrl` 指向自托管实例也能解决。浏览器**看不到**上游的错误细节 —— 请求是宿主代发的。
- **手动模式工具清单为空**：需点「+ 添加一个工具」逐行填写工具名；本插件不读取任何已安装清单（见「为什么不用清单选择」一节）。
