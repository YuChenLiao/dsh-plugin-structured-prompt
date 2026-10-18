# 自动扩写填表（2026-10，分支 feat/assist-autofill）

## 做什么

表单里写一句需求 → 宿主跑一次**子代理**把它扩写成结构化字段的增量补丁 → 补丁填进表单。

链路：浏览器 → 同源路由 POST /api/structured-prompt/assist → subagents.start → 浏览器。
**主 agent 上下文里看不到任何内容**（对比工具路径 host/tool.ts 的 delegate：那条是把结果
返回给模型）。唯一痕迹是会话树里会多一个子会话 —— 别写成"完全无痕"。

## 三条硬约束

1. **父级必须是一个 Session**（DSH subagent/src/catalog.ts 是 parent: Session），所以请求带
   sessionId；indSession 按鸭子类型探测（能 ppend 才算 Session），取不到报 409 ——
   不编假父级。这条判据是审查加的：原先"任意非空返回值就当 Session"，拿到快照/scope 时会抛
   parent.append is not a function，而那条错误会原样回给用户。
2. **模型输出必须过校验**：xtractJsonObject（括号配对扫描，取第一个完整对象，不修补）+
   parseFormDocument（复用导入那条路径）。全部字段被丢弃 → 502，不落空表单。
3. **素材不可伪造边界**：{request, existingFields} 整体 JSON 包裹进提示词。文本拼接时素材里写
   --- 素材结束 --- 就能逃出隔离区（审查实测的 M1）。

## 审查抓到的那条阻断

setForm(patch) 走 completeForm，会把模型**没返回**的字段填成空值 —— 用户填了 5 个字段、点
一下自动填充、模型只给 2 个，剩下 3 个被清空。而代码注释里写着"避免覆盖用户内容"，与实现相反。
改成新增 mergeForm（只覆盖给定的键），顺带避开"异步回调里用旧快照"的竞态。

这条的教训：**"补丁"这个语义在 store 上没有对应动作时，借用了"整表替换"**。断言当时一条都没覆盖
主链，所以八套全绿也发现不了。

## 断言与反向验证

- 主链（模型返回 JSON → 提取 → 校验 → patch/warnings）、全部被丢弃 → 502、父级不像 Session → 409、
  素材 JSON 包裹、入参白名单、渲染侧的四种状态（含 data-assist-status 锚点）。
- 反向验证：把校验换成"直接采用" → 2 条红；把 Session 判据改恒真 → 3 条红。

## 已知边界

- **真实子代理没跑过**（离线测不了）：模型是否老实只输出 JSON、是否漏字段，只能上线看。阻断的
  严重性正取决于"漏字段"的常见程度 —— 修完 mergeForm 后漏字段只会"补不全"，不再"清空"。
- 没有取消按钮：95 秒硬等，关弹窗后请求仍在跑、结果仍会写进表单（有了 mergeForm 不再丢数据，
  但用户不在场时字段会被改动）。
- sessions 服务的真实形状仍未在源码里定位到（packages/session* 全是子包），所以父级探测只能
  靠鸭子类型；get/yId/ind/esolve 哪个是"按 id 取"待运行环境确认。

## 未合并

按使用者要求，本分支不合并 main。