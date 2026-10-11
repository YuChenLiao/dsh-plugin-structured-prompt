# dsh-plugin-structured-prompt

把 DSH 输入框切换成**结构化提示词表单**的插件。

在输入框底部的「结构化输入任务」，点开即弹出结构化提示词表单。填完后可以一键把构建好的提示词同步回输入框，再照常编辑、发送。

## 功能

- **输入框底部入口**：入口按钮在输入框工具栏里（`conversation.input.left`，与计划/权限控件同一行），点开弹出表单。
- **弹窗表单**：宽度固定（`clamp(600px, 74vw, 900px)`），高度**由内容决定、最多占窗口 70%**（`max-height: 70vh`）——不会占满屏幕；内容超出上限时在弹窗**右侧**出现滚动条（内容区需要 `overflow-y: auto` + `flex: 1 1 auto` + `min-height: 0` 才能正确收缩，`scrollbar-gutter: stable` 避免内容增减时左右跳动）。
- **弹窗分三段**：标题栏（标题 + 必填提示）/ 可滚动内容区（四个分组）/ **底部操作栏**（模板、导入、导出、清空在左，返回在右）。滚轮只作用于内容区，标题栏与底部操作栏常驻。
- **点遮罩不关闭**：遮罩不绑定点击处理器，避免误触丢失已填内容；关闭只经由底部「返回输入框」或 Esc（Esc 会先收起正在展开的候选选择器）。
- **分组不裁剪内容**：分组只用「标题 + 分隔线」，**不用卡片包裹**。卡片带来 `overflow: hidden`，会把需要更多高度的字段裁掉、也截断外层滚动——这正是"表单项展示不全"的根因。任何层级都不设 `max-height` 去限制字段。
- **`min-height: 0` 只属于滚动容器**：分组容器**不写** `min-height`，保留默认的 `min-height: auto` 让它按内容撑高；若误写在分组上，分组会被压缩到内容高度以下、子元素互相压叠（症状是分组标题与上一个字段的输入框重叠）。这条与上一条一样由渲染测试直接断言。
- **表单字段不限高**：多行文本域不写死行数，高度随内容自适应（`field-sizing: content`，不支持的浏览器由 `onInput` 兜底）。
- **四组、默认只展开基础信息**：基础信息展开，约束与规则 / 工具策略 / 输出与兜底默认折叠，展开哪组只看哪组。
- **工具策略自动或手动**：
  - **自动**：交给模型自行判断，提示词里只写一句「由你根据任务需要自行判断并选择要调用的工具；不需要工具时直接回答。」
  - **手动**：由你**直接填写**要允许调用的工具名（可加一行用途），提示词生成「只允许调用下列已指定的工具，其余工具一律不要使用」+ 逐行清单。工具名与用途按原始索引配对：用途可留空（只写工具名），工具名留空的行整体忽略。
  - 刻意**不提供**「从已安装清单里勾选」：DSH 的插件清单列的是自带插件而非用户安装的插件，skills 清单也不属于本插件的职责；工具检索在输入框的 `/` 菜单里。本插件因此**不读取任何主机数据**，`inject` 只有 `slots`。
- **返回输入框二选一**：**同步并返回**（把构建好的提示词写入输入框草稿）/ **不同步，直接返回**（保留输入框原有草稿）。
- **实时预览**：表单底部可展开查看当前构建出的完整提示词与字数。
- **模板与导入导出**：内置「告警研判（原始示例）、代码审查、数据提取、报告撰写」四套模板；表单可导出为 JSON、从 JSON 导入，便于跨会话复用。
- **跟随主题**：颜色与阴影全部走 DSH 主题 token（`--dsw-alias-*`、`--dsw-elevation-prominent`），深浅色主题自动切换。

## 表单项（18 项）

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
# 输出格式                 ← 格式骨架 + 字段说明 + 表达要求 + 自定义说明
# 数据不足时
# 示例
```

空段落整体省略，非空段落之间以单个空行连接。

## 定位说明

本插件是**提示词构建器**：DSH 的系统提示由主机每步组装，客户端插件没有「仅对单次对话注入 system prompt」的接口，因此产出的提示词**同步到输入框、以用户消息形式发送**，由你确认后再发出。

## 安装

```powershell
dsh plugin --profile desktop add link:D:\dsh\dsh-plugin-structured-prompt
```

插件通过 `dsh.bundle.patch` 挂载；`dsh plugin add` 会同时登记依赖、bundle 与 Loader 行。**安装后需要重启 DSH**（客户端插件的模块图在启动时建立）。

## 开发

```powershell
# 1) 准备离线测试用的 React 链接（幂等，只需一次）
node tools/setup-dev-links.mjs

# 2) 构建产物 lib/index.js（host）与 lib/client.js（浏览器）
node tools/lib/build.mjs

# 3) 四套验证
node --import ./tools/lib/loader-hook.mjs tools/test-registration.mjs  # 注册契约（槽位/store 座位）
node --import ./tools/lib/loader-hook.mjs tools/test-render.mjs        # 渲染与交互结构
node tools/test-prompt.mjs                                             # 提示词构建行为
node tools/verify-install.mjs                                          # 安装与产物契约
```

构建复用 DSH 源码树中已安装的 tsdown（默认 `D:\dsh\deepseek-harness`，可用 `DSH_SOURCE_ROOT` 覆盖），本插件自身没有 devDependency。

### 槽位注册契约（注册测试守住的那条线）

`useStore` / `actions` **不是**槽位标准 props。渲染器只在注册声明了 `store` 座位时才注入它们：

```js
ctx.slots.register({ name, id, order, store }, Component)   // 组件里才有 props.useStore / props.actions
```

漏声明 `store` → 组件拿到 `undefined` → 渲染时抛错 → 条目被隔离失效（表现就是"按钮不见了"，且槽位检查里该条目 `active: false`）。这条契约渲染测试抓不到（渲染测试直接给组件喂 `useStore`），因此单独由 `tools/test-registration.mjs` 在注册层断言：**每个注册都必须声明 `store`，且两者共用同一个句柄**。

### 产物契约

`lib/client.js` 必须保持 DSH 动态客户端 bundle 的格式：

```js
window.__ModuleLoader__.load({ id: 'dsh-plugin-structured-prompt', factory: require => { ... } })
```

- `react` 与 `@deepseek-ai/dsh-client-store` 走注入的 `require`（模块表提供），其余依赖内联；
- `lib/index.js` 是 host 半边，本插件不注册模型可见输入，保持空 `apply`。

## 架构

```text
src/index.js              host 半边（空 apply）
src/client/index.js       槽位注册（input.left 入口 + input.dock 弹窗）
src/client/store.js       会话级状态（defineStore）
src/client/prompt.js      提示词构建核心（纯函数）+ 模板库
src/client/Form.js        入口按钮与表单弹窗 UI
tools/lib/build.mjs       构建脚本
tools/test-*.mjs          验证脚本
```

两个槽位注册，**都声明同一个 `store` 句柄**：

| 槽位 | 组件 | 职责 |
| --- | --- | --- |
| `conversation.input.left`（list） | `StructuredInputTrigger` | 输入框底部工具栏里的入口按钮 |
| `conversation.input.dock`（list） | `StructuredInputPanel` | 开启时渲染表单弹窗，关闭时不占空间 |

两处 `store` 座位不可省略（见上文[槽位注册契约](#槽位注册契约注册测试守住的那条线)），否则组件拿不到 `useStore` 会直接崩溃失效。声明后渲染器按「handle × sessionId」共享同一实例，所以入口的 `open()` 会直接驱动弹窗组件重渲染——不需要任何跨注册的状态同步。

### 为什么不用另外两个候选挂载点

DSH 里"接管输入框"看起来有两个更直接的位置，但都不能满足"点击后才接管"：

| 候选 | 机制 | 为什么不用 |
| --- | --- | --- |
| `conversation.composer`（chain） | 每个入口提供一个纯 `select(owner)`，第一个返回非 null 的接管 | `select` 只在**槽位重渲染**时重新执行。store 更新不会触发槽位重渲染（只有 session 源/props 变化才会，例如 `pendingInteraction`），所以点击后 `select` 不会被重新评估，表单永远不出现 |
| `conversation.composer.bar`（single） | 同 cell 中最低 `priority` 的条目渲染（遮蔽） | 遮蔽是**静态**的：一旦注册就固定获胜，无法"仅在开启时"遮蔽 InputBar；而未开启时若由本插件获胜，输入框就消失了（本插件渲染 null 也不会回落到 InputBar） |

链的 `overlay: true`（`conversation.composer` 的实际渲染参数）会让 fallback 即 InputBar 保持挂载、仅被隐藏，草稿与编辑器状态因此不会在切换中丢失——这也是"同步并返回"能安全写入草稿的前提（`ConversationSession` 在挂载时把 shell 的 `setDraft` 镜像回编辑器）。

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
- **手动模式里清单为空**：skills 清单按会话解析，空白会话可能没有可选项；插件清单只列启用中的条目。
