window.__ModuleLoader__.load({
	id: "dsh-plugin-structured-prompt",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		//#region src/client/store.js
		/**
		* 结构化输入任务的共享状态。
		*
		* 两个槽位入口共用同一个 store 句柄：输入框工具栏的入口按钮
		* （`conversation.input.left`）负责切换开关，composer 链入口
		* （`conversation.composer`）负责在开启时接管整张输入卡渲染表单。实例由
		* Slot 渲染器按「handle × sessionId」缓存，因此 `select` 能在渲染前读到
		* 本次会话的实时开关状态，表单内容也随会话隔离并在重新挂载后保留。
		*
		* 表单字段与渲染关系：
		*  - 全部 18 个字段构成 `PromptForm`，其中 `role`/`goal` 必填。
		*  - `toolPolicy` 为 `'auto'` 时由模型自行判断工具，`'manual'` 时用
		*    `selectedSkills` / `selectedPlugins` 指定能力。
		*  - 数组字段 `rules`/`forbidden`/`toolGuidance`/`fields` 逐条增删改序。
		*/
		/**
		* 空白表单：所有数组为空、所有文本为空，保证「未填写」与「空串」一致。
		* @returns 全新的空白表单对象。
		*/
		function emptyForm() {
			return {
				role: "",
				goal: "",
				background: "",
				successCriteria: "",
				rules: [],
				forbidden: [],
				toolPolicy: "",
				/**
				* 手动策略下由用户直接填写的可调用工具名。
				*
				* 这里刻意不提供「从已安装清单里勾选」：DSH 的插件清单列的是自带插件而非
				* 用户安装的插件，skills 清单也不属于本插件的职责；工具检索在输入框的 `/`
				* 菜单里，表单只需要把用户点名的工具写进提示词。
				*/
				callableTools: [],
				/** 与 `callableTools` 一一对应的用途说明（可为空串）。 */
				toolSlots: [],
				toolGuidance: [],
				toolFailure: "",
				outputSpec: "",
				outputFormat: "",
				languageTone: "",
				fields: [],
				fallback: "",
				examples: ""
			};
		}
		/**
		* 空白会话状态。
		* @returns 全新的初始状态。
		*/
		function emptyState() {
			return {
				active: false,
				form: emptyForm(),
				/**
				* 已折叠的分组 id。默认只展开「基础信息」，其余三组折叠，避免表单一打开
				* 就占满屏幕；用户展开哪一组只看那一组。
				*/
				collapsed: [
					"rules",
					"tools",
					"output"
				]
			};
		}
		/**
		* 声明结构化输入任务的 store。
		* @returns store 句柄，写集覆盖整表替换、字段写入、数组条目增删改序与分组折叠。
		*/
		function createStructuredInputStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: emptyState,
				actions: {
					/** 打开结构化表单模式。 */
					open: (draft) => {
						draft.active = true;
					},
					/** 关闭并回到输入框模式（表单内容保留，便于再次进入）。 */
					close: (draft) => {
						draft.active = false;
					},
					/**
					* 整表替换（模板一键填充 / JSON 导入）。
					* @param draft - store 草稿。
					* @param form - 完整表单对象。
					*/
					setForm: (draft, form) => {
						draft.form = {
							...emptyForm(),
							...form
						};
					},
					/**
					* 写入单个字段。
					* @param draft - store 草稿。
					* @param key - 字段名。
					* @param value - 字段值。
					*/
					setField: (draft, key, value) => {
						draft.form[key] = value;
					},
					/**
					* 数组字段追加一条。
					* @param draft - store 草稿。
					* @param key - 数组字段名。
					* @param value - 新条目内容。
					*/
					addItem: (draft, key, value) => {
						draft.form[key].push(value);
					},
					/**
					* 数组字段改写第 index 条。
					* @param draft - store 草稿。
					* @param key - 数组字段名。
					* @param index - 目标下标。
					* @param value - 新内容。
					*/
					setItem: (draft, key, index, value) => {
						if (index < 0 || index >= draft.form[key].length) return;
						draft.form[key][index] = value;
					},
					/**
					* 数组字段删除第 index 条。
					* @param draft - store 草稿。
					* @param key - 数组字段名。
					* @param index - 目标下标。
					*/
					removeItem: (draft, key, index) => {
						if (index < 0 || index >= draft.form[key].length) return;
						draft.form[key].splice(index, 1);
					},
					/**
					* 数组字段上下移动（delta 为 -1 或 1）。
					* @param draft - store 草稿。
					* @param key - 数组字段名。
					* @param index - 当前下标。
					* @param delta - 位移量。
					*/
					moveItem: (draft, key, index, delta) => {
						const items = draft.form[key];
						const next = index + delta;
						if (index < 0 || index >= items.length || next < 0 || next >= items.length) return;
						const moved = items.splice(index, 1)[0];
						items.splice(next, 0, moved);
					},
					/**
					* 切换分组折叠状态。
					* @param draft - store 草稿。
					* @param id - 分组 id。
					*/
					toggleSection: (draft, id) => {
						const at = draft.collapsed.indexOf(id);
						if (at >= 0) draft.collapsed.splice(at, 1);
						else draft.collapsed.push(id);
					},
					/** 清空表单，回到空白状态。 */
					reset: (draft) => {
						draft.form = emptyForm();
					}
				}
			});
		}
		//#endregion
		//#region src/client/prompt.js
		/**
		* 结构化提示词构建核心。
		*
		* 段落顺序与格式严格保持与原始实现一致：
		*   身份 → 目标 → 硬性规则（必须遵守，优先于其他任何要求）→ 工具使用策略
		*   → 输出格式 → 数据不足时 → 示例
		* 非空段落之间以单个空行连接，空段落整体省略。
		*
		* 扩写字段都落在既有段落的语义位置上（例如「背景与上下文」并入身份段、
		* 「禁止行为」作为硬性规则段的子块），因此没有引入新的顶层段落。
		*/
		/** 把文本按行清洗：去掉行尾空白、折叠连续空行、去首尾空行。 */
		function normalizeBlock(text) {
			if (typeof text !== "string") return "";
			return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
		}
		/** 逐条清洗数组：丢弃空白条目并去掉首尾空白。 */
		function cleanList(items) {
			if (!Array.isArray(items)) return [];
			return items.map((item) => typeof item === "string" ? item.trim() : "").filter((item) => item !== "");
		}
		/** 输出格式类型到 `outputSpec` 骨架的映射（用户可在表单里再改）。 */
		const OUTPUT_FORMAT_SKELETONS = {
			json: ["以 JSON 输出，字段如下：", "- field_name: type  // 说明"].join("\n"),
			markdown: [
				"以 Markdown 输出，结构如下：",
				"## 结论",
				"## 依据",
				"## 后续动作"
			].join("\n"),
			table: [
				"以 Markdown 表格输出，列如下：",
				"| 项 | 值 | 说明 |",
				"| --- | --- | --- |"
			].join("\n"),
			text: "以纯文本输出，先给结论，再给依据，不要使用 Markdown 标记。"
		};
		/** 工具调用策略的固定引导语。 */
		const TOOL_POLICY_AUTO = "由你根据任务需要自行判断并选择要调用的工具；不需要工具时直接回答。";
		/**
		* 手动模式下按用户点名的工具生成指定调用语句。
		*
		* 工具名与用途按**原始索引**配对：用途可以留空（只写工具名），也可以只有用途
		* 而工具名留空（该行整体忽略）。这里刻意不先过滤数组 —— 过滤会丢掉空串、让
		* 用途与工具名错位。
		*
		* 也不做"从已安装清单里勾选"—— DSH 的插件清单列的是自带插件而非用户安装的
		* 插件，工具检索属于输入框 `/` 菜单的职责，表单只负责把用户点名的工具写进提示词。
		* @param tools - 用户填写的工具名（可含空串）。
		* @param slots - 与 `tools` 索引对齐的用途说明（可含空串）。
		* @returns 策略说明文本；没有任何有效工具时返回空串。
		*/
		function manualPolicyText(tools, slots) {
			const lines = tools.map((rawTool, index) => {
				const tool = (rawTool ?? "").trim();
				if (tool === "") return "";
				const purpose = (slots[index] ?? "").trim();
				return purpose === "" ? `- ${tool}` : `- ${tool}：${purpose}`;
			}).filter((line) => line !== "");
			if (lines.length === 0) return "";
			return ["只允许调用下列已指定的工具，其余工具一律不要使用：", ...lines].join("\n");
		}
		/**
		* 构建结构化系统提示词。
		* @param form - 表单字段（见 store.js 的 PromptForm）。
		* @returns 组装后的提示词；身份与目标均为空时返回空串。
		*/
		function buildSystemPrompt(form) {
			const rules = cleanList(form.rules);
			const forbidden = cleanList(form.forbidden);
			const guidance = cleanList(form.toolGuidance);
			const fields = cleanList(form.fields);
			const identity = [normalizeBlock(form.role), normalizeBlock(form.background)].filter(Boolean).join("\n");
			const goal = [normalizeBlock(form.goal), normalizeBlock(form.successCriteria) === "" ? "" : `完成标准：${normalizeBlock(form.successCriteria)}`].filter(Boolean).join("\n");
			const rulesBody = [rules.length === 0 ? "" : rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n"), forbidden.length === 0 ? "" : ["禁止行为（同样不可违反）：", ...forbidden.map((item) => `- ${item}`)].join("\n")].filter(Boolean).join("\n");
			const guidanceBody = [
				form.toolPolicy === "auto" ? TOOL_POLICY_AUTO : form.toolPolicy === "manual" ? manualPolicyText(form.callableTools ?? [], form.toolSlots ?? []) : "",
				guidance.length === 0 ? "" : guidance.map((item) => `- ${item}`).join("\n"),
				normalizeBlock(form.toolFailure) === "" ? "" : `工具失败时：${normalizeBlock(form.toolFailure)}`
			].filter(Boolean).join("\n");
			const outputBody = [
				form.outputFormat === "" ? "" : OUTPUT_FORMAT_SKELETONS[form.outputFormat] ?? "",
				fields.length === 0 ? "" : ["字段说明：", ...fields.map((item) => `- ${item}`)].join("\n"),
				normalizeBlock(form.languageTone) === "" ? "" : `表达要求：${normalizeBlock(form.languageTone)}`,
				normalizeBlock(form.outputSpec)
			].filter(Boolean).join("\n");
			return [
				identity === "" ? "" : `# 身份\n${identity}`,
				goal === "" ? "" : `# 目标\n${goal}`,
				rulesBody === "" ? "" : `# 硬性规则（必须遵守，优先于其他任何要求）\n${rulesBody}`,
				guidanceBody === "" ? "" : `# 工具使用策略\n${guidanceBody}`,
				outputBody === "" ? "" : `# 输出格式\n${outputBody}`,
				normalizeBlock(form.fallback) === "" ? "" : `# 数据不足时\n${normalizeBlock(form.fallback)}`,
				normalizeBlock(form.examples) === "" ? "" : `# 示例\n${normalizeBlock(form.examples)}`
			].filter(Boolean).join("\n\n");
		}
		/** 必填校验：身份与目标。 */
		function validateForm(form) {
			const missing = [];
			if (normalizeBlock(form.role) === "") missing.push("身份");
			if (normalizeBlock(form.goal) === "") missing.push("目标");
			return missing;
		}
		/** 原始使用示例：一键填充用的「告警研判」模板。 */
		const ALERT_TRIAGE_TEMPLATE = {
			role: "你是一名负责线上稳定性的 SRE 助手，服务于一个日订单量百万级的电商系统。",
			goal: "根据监控数据判断告警是否需要人工立即介入，并给出首要排查方向。",
			background: "",
			successCriteria: "",
			rules: [
				"只能基于工具返回的数据下结论，不得引用记忆中其他系统的经验值。",
				"所有数值必须带上单位和时间窗口，例如 940ms / 近 5 分钟。",
				"阈值判断必须以指标配置为准；配置缺失时明确说明缺失，不要用默认值代替。"
			],
			forbidden: ["不得输出任何猜测性的根因结论（例如“疑似数据库慢查询”）。"],
			toolPolicy: "auto",
			callableTools: [],
			toolSlots: [],
			toolGuidance: ["先调用 query_metrics 拿指标，再调用 get_threshold_config 拿阈值，顺序不可颠倒。", "如果指标数据的时间窗口与阈值配置不一致，先调用 list_metric_windows 确认可用窗口。"],
			toolFailure: "任何一次工具调用失败，最多重试一次；仍失败则直接报告失败，不要用估计值代替。",
			outputSpec: "",
			outputFormat: "json",
			languageTone: "",
			fields: [
				"severity: \"P0\" | \"P1\" | \"P2\" | \"info\"",
				"metric: { name, value, unit, window }",
				"threshold: { value, unit, source } 或 null",
				"breached: boolean",
				"first_checks: string[]  // 1-3 条首要排查方向",
				"data_gaps: string[]     // 缺失的数据项，没有则空数组"
			],
			fallback: "若关键指标或阈值任一缺失，severity 返回 \"info\"，并在 data_gaps 中列出缺失项。禁止编造数值。",
			examples: ""
		};
		/** 内置模板库：填充的是表单字段，不是成稿提示词。 */
		const TEMPLATES = [
			{
				id: "alert-triage",
				label: "告警研判（原始示例）",
				build: () => ({ ...ALERT_TRIAGE_TEMPLATE })
			},
			{
				id: "code-review",
				label: "代码审查",
				build: () => ({
					role: "你是一名严格的高级工程师，负责对提交的改动做缺陷导向的代码审查。",
					goal: "找出改动中会导致线上故障、数据错误或安全问题的缺陷，并按严重度排序。",
					background: "",
					successCriteria: "每条结论都能指向具体文件与代码位置；没有发现缺陷时明确说明。",
					rules: ["只审查本次改动涉及的范围，不扩展评审范围。", "每条问题必须给出文件路径与行号。"],
					forbidden: ["不得提出纯粹的风格偏好（命名、空行、注释密度）。"],
					toolPolicy: "auto",
					callableTools: [],
					toolSlots: [],
					toolGuidance: ["先读取改动范围内的文件，再下结论。"],
					toolFailure: "读取失败时明确说明哪些文件未能读取，不要凭猜测补充内容。",
					outputSpec: "",
					outputFormat: "json",
					languageTone: "简洁直接，中文，不写客套话。",
					fields: [
						"severity: \"blocker\" | \"major\" | \"minor\"",
						"file: string",
						"line: number",
						"problem: string",
						"suggestion: string"
					],
					fallback: "若无法获取完整改动内容，返回空数组并在 summary 中说明原因。",
					examples: ""
				})
			},
			{
				id: "data-extract",
				label: "数据提取",
				build: () => ({
					role: "你是一名数据抽取助手，把非结构化文本转换为结构化记录。",
					goal: "从输入文本中抽取指定字段，输出可直接入库的记录。",
					background: "",
					successCriteria: "每条记录字段齐全且与原文一致。",
					rules: ["字段值必须逐字来自原文，不得改写或补全。"],
					forbidden: ["不得编造原文中不存在的字段值。"],
					toolPolicy: "auto",
					callableTools: [],
					toolSlots: [],
					toolGuidance: [],
					toolFailure: "",
					outputSpec: "",
					outputFormat: "json",
					languageTone: "",
					fields: ["records: object[]  // 每条记录一条"],
					fallback: "字段在原文中缺失时填 null，并在 missing 数组中列出字段名。禁止编造。",
					examples: ""
				})
			},
			{
				id: "report",
				label: "报告撰写",
				build: () => ({
					role: "你是一名技术分析师，把已有材料整理成可决策的报告。",
					goal: "基于给定材料输出一份结论先行、依据可追溯的简报。",
					background: "",
					successCriteria: "读者能在第一段拿到结论与建议。",
					rules: ["结论必须由给出的材料支撑，不引入材料之外的事实。"],
					forbidden: ["不得虚构数据、时间或引用来源。"],
					toolPolicy: "auto",
					callableTools: [],
					toolSlots: [],
					toolGuidance: [],
					toolFailure: "",
					outputSpec: "",
					outputFormat: "markdown",
					languageTone: "中文，面向管理者，控制在一页内。",
					fields: [],
					fallback: "材料不足以支撑某项结论时，在「待确认」一节列出，不要给出推测值。",
					examples: ""
				})
			}
		];
		//#endregion
		//#region src/client/Form.js
		/**
		* 结构化输入任务的 UI。
		*
		* 两个导出：
		*  - `StructuredInputTrigger`：`conversation.input.left`——输入框底部工具栏里的入口。
		*  - `StructuredInputPanel`：`conversation.input.dock`——开启时渲染表单弹窗。
		*
		* 弹窗结构：标题栏（标题 + 必填提示）/ 可滚动内容区（四个分组）/ 底部操作栏
		* （模板、导入、导出、清空、返回）。滚轮与滚动条只作用于内容区，标题栏和底部
		* 操作栏常驻可见。
		*
		* 视觉全部走 DSH 主题 token（`--dsw-alias-*` / `--dsw-elevation-*`），深浅色
		* 主题自动跟随。
		*/
		/** 主题 token（均带回退值，token 缺失时仍可读）。 */
		const C = {
			surface: "var(--dsw-alias-bg-layer-1, #ffffff)",
			mask: "var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.24))",
			maskBlur: "var(--dsw-mask-blur, blur(2px))",
			shadow: "var(--dsw-elevation-prominent, 0 4px 16px rgba(0,0,0,0.12))",
			text: "var(--dsw-alias-label-primary, inherit)",
			textSecondary: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.95))",
			caption: "var(--dsw-alias-label-caption, rgba(128,128,128,0.85))",
			border: "var(--dsw-alias-border-l2, rgba(128,128,128,0.22))",
			borderStrong: "var(--dsw-alias-border-l3, rgba(128,128,128,0.34))",
			accent: "var(--dsw-alias-state-business-primary, #4d6bfe)",
			accentSoft: "var(--dsw-alias-state-business-tertiary, rgba(77,107,254,0.14))",
			danger: "var(--dsw-alias-state-error-primary, #e5484d)",
			/** 返回确认条的极淡底色（分组不用卡片，这里仍需要一点填充做区分）。 */
			subtle: "var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.05))"
		};
		/** 输入框底部工具栏里的入口按钮（与计划/权限控件同一行）。 */
		const triggerButtonStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 5,
			height: 24,
			padding: "0 8px",
			border: `1px solid ${C.border}`,
			borderRadius: 8,
			background: "transparent",
			color: C.textSecondary,
			font: "inherit",
			fontSize: 12,
			lineHeight: 1,
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		const maskStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 40,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 24,
			boxSizing: "border-box",
			background: C.mask,
			backdropFilter: C.maskBlur
		};
		const modalStyle = {
			display: "flex",
			flexDirection: "column",
			width: "clamp(600px, 74vw, 900px)",
			maxWidth: "100%",
			maxHeight: "70vh",
			border: 0,
			borderRadius: 16,
			background: C.surface,
			boxShadow: C.shadow,
			color: C.text,
			fontSize: 13,
			overflow: "hidden"
		};
		const modalHeadStyle = {
			display: "flex",
			alignItems: "center",
			gap: 10,
			flexWrap: "wrap",
			flex: "none",
			padding: "12px 16px",
			borderBottom: `1px solid ${C.border}`
		};
		/**
		* 弹窗内容区：`flex: 1 1 auto` + `minHeight: 0` 是它能在弹窗内正确收缩、并在
		* 高度溢出时于**右侧**出现滚动条的关键；没有这两项，内容会被父级的
		* `overflow: hidden` 直接裁掉（那正是字段看起来"被隐藏"的原因）。
		*
		* 导出是为了让离线测试直接断言滚动条的挂载点与收缩行为。
		*/
		const modalBodyStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			padding: "16px 18px",
			flex: "1 1 auto",
			minHeight: 0,
			overflowY: "auto",
			overflowX: "hidden",
			scrollbarGutter: "stable"
		};
		/** 底部操作栏：放弃类操作在左，确认类操作在右。 */
		const modalFootStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 10,
			flexWrap: "wrap",
			flex: "none",
			padding: "12px 16px",
			borderTop: `1px solid ${C.border}`
		};
		/**
		* 分组不用卡片包裹：卡片会带来 `overflow: hidden`，一旦内层需要更多高度就会
		* 被裁掉，而且会截断外层的滚动。改为纯标题 + 分隔线，内容自然展开，溢出由弹窗
		* 内容区的滚动条统一处理。
		*
		* 导出是为了让离线测试直接断言"任何层级都不裁剪内容"这条不变量。
		*/
		const sectionStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 12
		};
		/** 分组标题：一条可点击的标题行，用底线作分隔。 */
		const sectionHeadStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			width: "100%",
			gap: 8,
			padding: "0 0 8px",
			border: 0,
			borderBottom: `1px solid ${C.border}`,
			background: "transparent",
			color: C.textSecondary,
			font: "inherit",
			fontSize: 12,
			fontWeight: 600,
			letterSpacing: "0.02em",
			cursor: "pointer",
			textAlign: "left"
		};
		const sectionBodyStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 14
		};
		const labelStyle = {
			display: "block",
			marginBottom: 5,
			fontSize: 12,
			color: C.textSecondary
		};
		const requiredMarkStyle = {
			color: C.danger,
			marginLeft: 3
		};
		/** 自适应高度下限：约两行，避免空字段显得过窄。 */
		const TEXTAREA_MIN_PX = 58;
		/** 自适应高度上限：单个字段约 16 行，再长就在文本域内部滚动。 */
		const TEXTAREA_MAX_PX = 338;
		const inputStyle = {
			width: "100%",
			boxSizing: "border-box",
			padding: "7px 9px",
			border: `1px solid ${C.border}`,
			borderRadius: 8,
			background: "transparent",
			color: "inherit",
			font: "inherit",
			fontSize: 13,
			lineHeight: 1.55,
			resize: "vertical"
		};
		const rowStyle = {
			display: "flex",
			alignItems: "center",
			gap: 6
		};
		const buttonStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			minWidth: 26,
			height: 26,
			padding: "0 8px",
			border: `1px solid ${C.border}`,
			borderRadius: 8,
			background: "transparent",
			color: "inherit",
			font: "inherit",
			fontSize: 12,
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		const primaryButtonStyle = {
			...buttonStyle,
			padding: "0 14px",
			height: 30,
			border: 0,
			background: C.accent,
			color: "var(--dsw-alias-label-primary-foreground, #fff)",
			fontWeight: 600
		};
		/** 选项 chip：选中时用主题的业务色。 */
		const chipStyle = (on) => ({
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			padding: "4px 10px",
			border: `1px solid ${on ? C.accent : C.border}`,
			borderRadius: 999,
			background: on ? C.accentSoft : "transparent",
			color: "inherit",
			font: "inherit",
			fontSize: 12,
			cursor: "pointer"
		});
		/** 分组：基础信息常开，其余三组默认折叠但可展开。 */
		const SECTIONS = [
			{
				id: "basic",
				title: "基础信息",
				collapsible: false
			},
			{
				id: "rules",
				title: "约束与规则",
				collapsible: true
			},
			{
				id: "tools",
				title: "工具策略",
				collapsible: true
			},
			{
				id: "output",
				title: "输出与兜底",
				collapsible: true
			}
		];
		/** 逐条编辑的数组字段。 */
		const LIST_FIELDS = [
			{
				key: "rules",
				label: "硬性规则（每行一条，会按 1. 2. 3. 编号）",
				placeholder: "例如：所有数值必须带上单位和时间窗口"
			},
			{
				key: "forbidden",
				label: "禁止行为（每行一条）",
				placeholder: "例如：不得输出猜测性的根因结论"
			},
			{
				key: "toolGuidance",
				label: "工具使用策略（每行一条）",
				placeholder: "例如：先调用 query_metrics 拿指标，再调用 get_threshold_config 拿阈值"
			},
			{
				key: "fields",
				label: "字段级说明（每行一条）",
				placeholder: "例如：severity: \"P0\" | \"P1\" | \"P2\" | \"info\""
			}
		];
		/** 供注入的样式：内联样式无法覆盖的伪类与滚动条。 */
		const PANEL_CSS = `
[data-structured-prompt-trigger]:hover {
  border-color: ${C.borderStrong};
  color: ${C.text};
}
[data-structured-prompt-modal] textarea,
[data-structured-prompt-modal] input,
[data-structured-prompt-modal] select {
  outline: none;
}
[data-structured-prompt-modal] textarea:focus,
[data-structured-prompt-modal] input:focus,
[data-structured-prompt-modal] select:focus {
  border-color: ${C.accent};
}
[data-structured-prompt-modal] textarea::placeholder,
[data-structured-prompt-modal] input::placeholder {
  color: ${C.caption};
}
[data-structured-prompt-modal] button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 弹窗内容区的右侧滚动条：细、无轨道、跟随主题。 */
[data-structured-prompt-modal] [data-scroll] {
  scrollbar-width: thin;
  scrollbar-color: ${C.borderStrong} transparent;
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar,
[data-structured-prompt-list]::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar-track,
[data-structured-prompt-list]::-webkit-scrollbar-track {
  background: transparent;
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar-thumb,
[data-structured-prompt-list]::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
  background-color: ${C.borderStrong};
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar-thumb:hover,
[data-structured-prompt-list]::-webkit-scrollbar-thumb:hover {
  background-color: ${C.caption};
}
`;
		/**
		* 浏览器是否支持 `field-sizing: content`（文本域按内容自适应高度）。
		* 支持的浏览器不需要 JS 参与；不支持的由 onInput 兜底。
		* @returns 是否支持。
		*/
		function supportsContentSizing() {
			if (typeof document === "undefined") return false;
			const probe = document.createElement("textarea");
			probe.style.fieldSizing = "content";
			return probe.style.fieldSizing === "content";
		}
		let contentSizing;
		/**
		* 多行文本域：高度随内容自适应，所以每条表单项都能完整展示，不会被限高。
		* @param props - 值、变更回调、占位符与无障碍名。
		* @returns 文本域元素。
		*/
		function TextArea({ value, onChange, placeholder, ariaLabel }) {
			if (contentSizing === void 0) contentSizing = supportsContentSizing();
			/** @param {HTMLTextAreaElement | null} element - 文本域。 */
			const fit = (element) => {
				if (element === null || contentSizing === true) return;
				element.style.height = "auto";
				element.style.height = `${Math.min(element.scrollHeight, TEXTAREA_MAX_PX)}px`;
			};
			return (0, react.createElement)("textarea", {
				value,
				placeholder,
				"aria-label": ariaLabel,
				style: {
					...inputStyle,
					minHeight: TEXTAREA_MIN_PX,
					maxHeight: TEXTAREA_MAX_PX,
					...contentSizing === true ? { fieldSizing: "content" } : {}
				},
				ref: (element) => {
					if (contentSizing !== true) fit(element);
				},
				onChange: (event) => {
					if (contentSizing !== true) fit(event.currentTarget);
					onChange(event.target.value);
				}
			});
		}
		/** 单行输入。 */
		function TextInput({ value, onChange, placeholder, ariaLabel }) {
			return (0, react.createElement)("input", {
				type: "text",
				value,
				placeholder,
				"aria-label": ariaLabel,
				style: {
					...inputStyle,
					resize: void 0
				},
				onChange: (event) => onChange(event.target.value)
			});
		}
		/** 带标题的字段块。 */
		function Field({ label, required, children }) {
			return (0, react.createElement)("div", null, (0, react.createElement)("label", { style: labelStyle }, label, required === true ? (0, react.createElement)("span", { style: requiredMarkStyle }, "*") : null), children);
		}
		/** 逐条编辑控件（增删改 + 上下移序）。 */
		function ListEditor({ field, items, actions }) {
			const list = Array.isArray(items) ? items : [];
			return (0, react.createElement)(Field, { label: field.label }, (0, react.createElement)("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 6
			} }, ...list.map((item, index) => (0, react.createElement)("div", {
				key: `item-${index}`,
				style: rowStyle
			}, (0, react.createElement)(TextInput, {
				value: item,
				ariaLabel: `${field.label} 第 ${index + 1} 条`,
				placeholder: field.placeholder,
				onChange: (value) => actions.setItem(field.key, index, value)
			}), (0, react.createElement)("button", {
				type: "button",
				style: buttonStyle,
				title: "上移",
				"aria-label": "上移",
				disabled: index === 0,
				onClick: () => actions.moveItem(field.key, index, -1)
			}, "↑"), (0, react.createElement)("button", {
				type: "button",
				style: buttonStyle,
				title: "下移",
				"aria-label": "下移",
				disabled: index === list.length - 1,
				onClick: () => actions.moveItem(field.key, index, 1)
			}, "↓"), (0, react.createElement)("button", {
				type: "button",
				style: buttonStyle,
				title: "删除这一条",
				"aria-label": "删除这一条",
				onClick: () => actions.removeItem(field.key, index)
			}, "×"))), (0, react.createElement)("button", {
				type: "button",
				style: {
					...buttonStyle,
					alignSelf: "flex-start"
				},
				onClick: () => actions.addItem(field.key, "")
			}, "+ 添加一条")));
		}
		/**
		* 手动策略的工具编辑：工具名与用途一一配对增删。
		*
		* 刻意不做「从已安装清单里勾选」—— DSH 的插件清单列的是自带插件而非用户安装
		* 的插件，skills 清单也不属于本插件的职责；工具检索在输入框的 `/` 菜单里，表单
		* 只负责把用户点名的工具按序写进提示词。
		* @param props - 表单与 store 动作。
		* @returns 配对编辑控件。
		*/
		function ToolPairEditor({ form, actions }) {
			const names = Array.isArray(form.callableTools) ? form.callableTools : [];
			const slots = Array.isArray(form.toolSlots) ? form.toolSlots : [];
			/** 删除一行：两个数组必须同步删，索引才始终对应。 */
			const remove = (index) => {
				actions.removeItem("callableTools", index);
				actions.removeItem("toolSlots", index);
			};
			return (0, react.createElement)(Field, { label: "可调用的工具（工具名 + 用途）" }, (0, react.createElement)("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 6
			} }, ...names.map((name, index) => (0, react.createElement)("div", {
				key: `tool-${index}`,
				style: rowStyle
			}, (0, react.createElement)(TextInput, {
				value: name,
				ariaLabel: `第 ${index + 1} 个工具名`,
				placeholder: "工具名，例如 query_metrics",
				onChange: (value) => actions.setItem("callableTools", index, value)
			}), (0, react.createElement)(TextInput, {
				value: slots[index] ?? "",
				ariaLabel: `第 ${index + 1} 个工具的用途`,
				placeholder: "用途（可留空）",
				onChange: (value) => actions.setItem("toolSlots", index, value)
			}), (0, react.createElement)("button", {
				type: "button",
				style: buttonStyle,
				title: "删除这一行",
				"aria-label": "删除这一行",
				onClick: () => remove(index)
			}, "×"))), (0, react.createElement)("button", {
				type: "button",
				style: {
					...buttonStyle,
					alignSelf: "flex-start"
				},
				onClick: () => {
					actions.addItem("callableTools", "");
					actions.addItem("toolSlots", "");
				}
			}, "+ 添加一个工具"), names.length === 0 ? (0, react.createElement)("div", { style: {
				color: C.caption,
				fontSize: 12
			} }, "尚未点名任何工具。手动策略下模型只被允许调用这里列出的工具；") : null));
		}
		/**
		* `conversation.input.dock` 的占用者：表单弹窗。
		*
		* 弹窗只在开启时渲染，未开启时返回 null 不占空间（入口按钮由
		* `StructuredInputTrigger` 负责）。遮罩点击**不会**关闭弹窗，避免误触丢失
		* 已填内容；关闭只经由底部「返回输入框」或 Esc。
		*
		* hook 调用必须先于任何提前返回（开关会改变渲染分支，分支后的 hook 会让
		* hook 数量随状态变化而抛错）。
		* @param props - 槽位 props（store 座位、inputActions 与注入的 loadCatalog）。
		* @returns 表单弹窗，或未开启时的 null。
		*/
		function StructuredInputPanel(props) {
			const { useStore, actions, inputActions, sessionId } = props;
			const active = useStore((state) => state.active === true);
			const form = useStore((state) => state.form);
			const collapsed = useStore((state) => state.collapsed);
			const [returnPrompt, setReturnPrompt] = (0, react.useState)(false);
			const importRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (active !== true) return void 0;
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					event.stopPropagation();
					actions.close();
					setReturnPrompt(false);
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => {
					window.removeEventListener("keydown", onKeyDown, true);
				};
			}, [active, actions]);
			if (active !== true || sessionId === void 0) return null;
			const prompt = buildSystemPrompt(form);
			const missing = validateForm(form);
			const canSync = missing.length === 0 && prompt !== "";
			/** 「同步已构建提示词并返回」：先写入编辑器草稿，再关闭弹窗。 */
			const syncAndClose = () => {
				if (!canSync) return;
				inputActions.setDraft(prompt);
				actions.close();
				setReturnPrompt(false);
			};
			/** 「不同步直接返回」：编辑器里的原有草稿保持不动。 */
			const closeWithoutSync = () => {
				actions.close();
				setReturnPrompt(false);
			};
			/** 导出当前表单为 JSON，便于在别的会话复用。 */
			const exportForm = () => {
				try {
					const blob = new Blob([JSON.stringify(form, null, 2)], { type: "application/json" });
					const url = URL.createObjectURL(blob);
					const anchor = document.createElement("a");
					anchor.href = url;
					anchor.download = "structured-prompt-form.json";
					anchor.click();
					URL.revokeObjectURL(url);
				} catch (error) {
					console.error("[structured-prompt] 导出表单失败：", error);
				}
			};
			/** 从用户选择的 JSON 文件导入表单。 */
			const importForm = (event) => {
				const file = event.target.files === null ? void 0 : event.target.files[0];
				event.target.value = "";
				if (file === void 0) return;
				file.text().then((text) => {
					actions.setForm(JSON.parse(text));
				}).catch((error) => {
					console.error("[structured-prompt] 导入表单失败：", error);
				});
			};
			const section = (id, children) => {
				const meta = SECTIONS.find((item) => item.id === id);
				const open = meta.collapsible !== true || !collapsed.includes(id);
				return (0, react.createElement)("div", {
					key: id,
					style: sectionStyle
				}, (0, react.createElement)("button", {
					type: "button",
					style: sectionHeadStyle,
					"aria-expanded": open,
					onClick: () => {
						if (meta.collapsible === true) actions.toggleSection(id);
					}
				}, (0, react.createElement)("span", null, meta.title), meta.collapsible === true ? (0, react.createElement)("span", { style: { color: C.caption } }, open ? "▾" : "▸") : null), open ? (0, react.createElement)("div", { style: sectionBodyStyle }, ...children) : null);
			};
			const listField = (key) => {
				return (0, react.createElement)(ListEditor, {
					key,
					field: LIST_FIELDS.find((item) => item.key === key),
					items: form[key],
					actions
				});
			};
			return (0, react.createElement)("div", {
				style: maskStyle,
				role: "presentation"
			}, (0, react.createElement)("div", {
				"data-structured-prompt-modal": "",
				style: modalStyle,
				role: "dialog",
				"aria-modal": true,
				"aria-label": "结构化输入任务"
			}, (0, react.createElement)("div", { style: modalHeadStyle }, (0, react.createElement)("div", { style: {
				...rowStyle,
				flex: "1 1 auto",
				minWidth: 0
			} }, (0, react.createElement)("span", { style: {
				fontSize: 14,
				fontWeight: 600
			} }, "结构化输入任务"), missing.length > 0 ? (0, react.createElement)("span", { style: {
				color: C.caption,
				fontSize: 12
			} }, `还差必填：${missing.join("、")}`) : null), (0, react.createElement)("button", {
				type: "button",
				"data-structured-prompt-close": "",
				style: {
					...buttonStyle,
					minWidth: 28,
					padding: "0 6px",
					fontSize: 14,
					lineHeight: 1
				},
				title: "关闭（不改动输入框内容）",
				"aria-label": "关闭",
				onClick: closeWithoutSync
			}, "×")), (0, react.createElement)("div", {
				"data-scroll": "",
				style: modalBodyStyle
			}, returnPrompt ? (0, react.createElement)("div", { style: {
				...rowStyle,
				flexWrap: "wrap",
				padding: "10px 12px",
				border: `1px solid ${C.borderStrong}`,
				borderRadius: 10,
				background: C.subtle
			} }, (0, react.createElement)("span", { style: {
				color: C.textSecondary,
				fontSize: 12
			} }, "返回前是否把已构建的提示词同步到输入框？"), (0, react.createElement)("button", {
				type: "button",
				style: {
					...primaryButtonStyle,
					opacity: canSync ? 1 : .5,
					cursor: canSync ? "pointer" : "not-allowed"
				},
				disabled: !canSync,
				title: canSync ? "把提示词写入输入框草稿" : "身份与目标为必填",
				onClick: syncAndClose
			}, "同步并返回"), (0, react.createElement)("button", {
				type: "button",
				style: buttonStyle,
				onClick: closeWithoutSync
			}, "不同步，直接返回")) : null, section("basic", [
				(0, react.createElement)(Field, {
					key: "role",
					label: "身份",
					required: true
				}, (0, react.createElement)(TextArea, {
					value: form.role,
					ariaLabel: "身份",
					placeholder: "例如：你是一名负责线上稳定性的 SRE 助手，服务于一个日订单量百万级的电商系统。",
					onChange: (value) => actions.setField("role", value)
				})),
				(0, react.createElement)(Field, {
					key: "goal",
					label: "目标",
					required: true
				}, (0, react.createElement)(TextArea, {
					value: form.goal,
					ariaLabel: "目标",
					placeholder: "例如：根据监控数据判断告警是否需要人工立即介入，并给出首要排查方向。",
					onChange: (value) => actions.setField("goal", value)
				})),
				(0, react.createElement)(Field, {
					key: "background",
					label: "背景与上下文"
				}, (0, react.createElement)(TextArea, {
					value: form.background,
					ariaLabel: "背景与上下文",
					placeholder: "业务场景、系统规模、技术栈等（会并入「身份」段）",
					onChange: (value) => actions.setField("background", value)
				})),
				(0, react.createElement)(Field, {
					key: "successCriteria",
					label: "成功标准"
				}, (0, react.createElement)(TextArea, {
					value: form.successCriteria,
					ariaLabel: "成功标准",
					placeholder: "可验收的完成判据（会并入「目标」段）",
					onChange: (value) => actions.setField("successCriteria", value)
				}))
			]), section("rules", [listField("rules"), listField("forbidden")]), section("tools", [
				(0, react.createElement)(Field, {
					key: "toolPolicy",
					label: "调用工具策略"
				}, (0, react.createElement)("div", { style: {
					...rowStyle,
					flexWrap: "wrap"
				} }, ...[
					["auto", "自动（交给模型自行判断）"],
					["manual", "手动（指定要调用的能力）"],
					["", "不指定"]
				].map(([value, text]) => (0, react.createElement)("button", {
					key: value === "" ? "none" : value,
					type: "button",
					style: chipStyle(form.toolPolicy === value),
					"aria-pressed": form.toolPolicy === value,
					onClick: () => actions.setField("toolPolicy", value)
				}, text)))),
				form.toolPolicy === "manual" ? (0, react.createElement)(ToolPairEditor, {
					key: "manual",
					form,
					actions
				}) : null,
				listField("toolGuidance"),
				(0, react.createElement)(Field, {
					key: "toolFailure",
					label: "工具失败时的处理"
				}, (0, react.createElement)(TextArea, {
					value: form.toolFailure,
					ariaLabel: "工具失败时的处理",
					placeholder: "例如：任何一次工具调用失败，最多重试一次；仍失败则直接报告失败，不要用估计值代替。",
					onChange: (value) => actions.setField("toolFailure", value)
				}))
			]), section("output", [
				(0, react.createElement)(Field, {
					key: "outputFormat",
					label: "输出格式类型"
				}, (0, react.createElement)("div", { style: {
					...rowStyle,
					flexWrap: "wrap"
				} }, ...[
					["", "未指定"],
					["json", "JSON"],
					["markdown", "Markdown"],
					["table", "表格"],
					["text", "纯文本"]
				].map(([value, text]) => (0, react.createElement)("button", {
					key: value === "" ? "none" : value,
					type: "button",
					style: chipStyle(form.outputFormat === value),
					"aria-pressed": form.outputFormat === value,
					onClick: () => {
						actions.setField("outputFormat", value);
						const skeleton = value === "" ? "" : OUTPUT_FORMAT_SKELETONS[value] ?? "";
						const known = Object.values(OUTPUT_FORMAT_SKELETONS);
						if (skeleton !== "" && (form.outputSpec.trim() === "" || known.includes(form.outputSpec))) actions.setField("outputSpec", skeleton);
					}
				}, text)))),
				(0, react.createElement)(Field, {
					key: "outputSpec",
					label: "输出格式说明"
				}, (0, react.createElement)(TextArea, {
					value: form.outputSpec,
					ariaLabel: "输出格式说明",
					placeholder: "以 JSON 输出，字段如下：…",
					onChange: (value) => actions.setField("outputSpec", value)
				})),
				listField("fields"),
				(0, react.createElement)(Field, {
					key: "languageTone",
					label: "语言与语气"
				}, (0, react.createElement)(TextInput, {
					value: form.languageTone,
					ariaLabel: "语言与语气",
					placeholder: "例如：中文，简洁直接，面向工程师",
					onChange: (value) => actions.setField("languageTone", value)
				})),
				(0, react.createElement)(Field, {
					key: "fallback",
					label: "数据不足时的行为"
				}, (0, react.createElement)(TextArea, {
					value: form.fallback,
					ariaLabel: "数据不足时的行为",
					placeholder: "例如：若关键指标或阈值任一缺失，severity 返回 \"info\"，并在 data_gaps 中列出缺失项。禁止编造数值。",
					onChange: (value) => actions.setField("fallback", value)
				})),
				(0, react.createElement)(Field, {
					key: "examples",
					label: "少样本示例"
				}, (0, react.createElement)(TextArea, {
					value: form.examples,
					ariaLabel: "少样本示例",
					placeholder: "给 1-2 个输入/输出对照示例",
					onChange: (value) => actions.setField("examples", value)
				}))
			]), (0, react.createElement)("details", { style: { fontSize: 12 } }, (0, react.createElement)("summary", { style: {
				cursor: "pointer",
				color: C.textSecondary
			} }, `预览已构建的提示词（${prompt.length} 字）`), (0, react.createElement)("pre", { style: {
				margin: "8px 0 0",
				maxHeight: 260,
				overflow: "auto",
				padding: 10,
				border: `1px solid ${C.border}`,
				borderRadius: 8,
				whiteSpace: "pre-wrap",
				fontSize: 12,
				lineHeight: 1.55
			} }, prompt === "" ? "（尚未填写身份与目标）" : prompt))), (0, react.createElement)("div", { style: modalFootStyle }, (0, react.createElement)("div", { style: {
				...rowStyle,
				flexWrap: "wrap"
			} }, (0, react.createElement)("select", {
				style: {
					...buttonStyle,
					padding: "0 8px"
				},
				value: "",
				title: "用内置模板填充表单",
				"aria-label": "用内置模板填充表单",
				onChange: (event) => {
					const picked = TEMPLATES.find((item) => item.id === event.target.value);
					event.target.value = "";
					if (picked !== void 0) actions.setForm(picked.build());
				}
			}, (0, react.createElement)("option", { value: "" }, "模板…"), ...TEMPLATES.map((item) => (0, react.createElement)("option", {
				key: item.id,
				value: item.id
			}, item.label))), (0, react.createElement)("button", {
				type: "button",
				style: buttonStyle,
				title: "从 JSON 导入表单",
				onClick: () => importRef.current?.click()
			}, "导入"), (0, react.createElement)("input", {
				ref: importRef,
				type: "file",
				accept: "application/json,.json",
				hidden: true,
				onChange: importForm
			}), (0, react.createElement)("button", {
				type: "button",
				style: buttonStyle,
				title: "导出当前表单为 JSON",
				onClick: exportForm
			}, "导出"), (0, react.createElement)("button", {
				type: "button",
				style: buttonStyle,
				title: "清空全部字段",
				onClick: () => actions.reset()
			}, "清空")), (0, react.createElement)("button", {
				type: "button",
				style: {
					...buttonStyle,
					borderColor: C.borderStrong
				},
				onClick: () => setReturnPrompt((value) => !value)
			}, "返回输入框"))));
		}
		/**
		* 输入框底部工具栏里的入口（`conversation.input.left`，与计划/权限控件同一行）。
		*
		* 只负责切换开关：置真后由同一 store 句柄驱动的 `StructuredInputPanel` 弹出表单。
		* 两者共用实例，因此不需要任何跨注册的状态同步。
		* @param props - 槽位 props（store 座位与 sessionId）。
		* @returns 入口按钮元素。
		*/
		function StructuredInputTrigger(props) {
			const { useStore, actions, sessionId } = props;
			const active = useStore((state) => state.active === true);
			const disabled = sessionId === void 0;
			return (0, react.createElement)("button", {
				type: "button",
				"data-structured-prompt-trigger": "",
				style: {
					...triggerButtonStyle,
					borderColor: active ? C.accent : C.border,
					background: active ? C.accentSoft : "transparent",
					color: active ? C.text : C.textSecondary,
					opacity: disabled ? .5 : 1,
					cursor: disabled ? "not-allowed" : "pointer"
				},
				title: "结构化输入任务：打开结构化提示词表单",
				"aria-haspopup": "dialog",
				"aria-expanded": active,
				disabled,
				onMouseDown: (event) => {
					event.preventDefault();
				},
				onClick: () => {
					actions.open();
				}
			}, "结构化输入任务");
		}
		//#endregion
		//#region src/client/index.js
		/**
		* 结构化输入任务插件 —— DSH 浏览器半边。
		*
		* 两个槽位注册，共用同一个 `store` 句柄：
		*  - `conversation.input.left`（list）—— 输入框底部工具栏里的入口按钮。
		*  - `conversation.input.dock`（list）—— 开启时渲染表单弹窗，关闭时不占空间。
		*
		* 两个注册**都必须声明 `store` 座位**：`useStore`/`actions` 不是标准 props，
		* 而是渲染器在 `host.storeOf(entry)` 有值时才注入的。漏声明会让组件拿到
		* `undefined`、渲染时抛错，条目随即被隔离失效（按钮就"消失"了）。注册表因此
		* 抽成 {@link slotEntries}，便于离线测试校验这条契约。
		*
		* 本插件不读取任何主机数据：手动工具策略由用户直接填写工具名，不再从"已安装
		* 清单"里勾选 —— DSH 的插件清单列的是自带插件而非用户安装的插件，skills 清单
		* 也不属于本插件的职责；工具检索在输入框的 `/` 菜单里。因此这里不需要
		* `remote`，也不需要任何 RPC。
		*
		* 表单弹窗挂在 `input.dock`，而不是接管输入框的两个候选：
		*  - `conversation.composer`（chain）：`select` 是纯函数，只在槽位重渲染时重新
		*    执行；store 更新不会触发槽位重渲染（只有 session 源/props 变化才会），所以
		*    链入口无法在用户点击后自行接管。
		*  - `conversation.composer.bar`（single）：遮蔽是静态的，同一 cell 只有最低
		*    优先级者渲染，无法"仅在开启时"接管。
		*/
		/** 只需要槽位注册。 */
		const inject = ["slots"];
		/**
		* 本插件的槽位注册表：`[槽位名, 注册选项, 组件]`。
		*
		* 两个注册共享同一个 store 句柄，渲染器按「handle × sessionId」共享实例，因此
		* 入口的 `open()` 会直接驱动弹窗组件重渲染，不需要跨注册的状态同步。
		* @param store - `createStructuredInputStore()` 的句柄。
		* @returns 注册三元组列表。
		*/
		function slotEntries(store) {
			return [[
				"conversation.input.left",
				{
					name: "conversation.input.left",
					id: "structured-prompt",
					order: 20,
					store
				},
				StructuredInputTrigger
			], [
				"conversation.input.dock",
				{
					name: "conversation.input.dock",
					id: "structured-prompt",
					order: 10,
					store
				},
				StructuredInputPanel
			]];
		}
		/**
		* 客户端插件主体。
		* @param ctx - Web Client 根上下文。
		*/
		function apply(ctx) {
			const store = createStructuredInputStore();
			ctx.effect(() => {
				const selector = "style[data-plugin-css=\"dsh-plugin-structured-prompt\"]";
				if (document.querySelector(selector) === null) {
					const tag = document.createElement("style");
					tag.dataset.plugin = "dsh-plugin-structured-prompt";
					tag.dataset.pluginCss = "dsh-plugin-structured-prompt";
					tag.textContent = PANEL_CSS;
					document.head.appendChild(tag);
				}
				return () => {
					const tag = document.querySelector(selector);
					if (tag !== null) tag.remove();
				};
			}, "structured-prompt: styles");
			for (const [slotName, options, component] of slotEntries(store)) ctx.slots.inject(slotName, () => ctx.slots.register(options, component));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.slotEntries = slotEntries;
		return module.exports;
	}
});
