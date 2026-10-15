window.__ModuleLoader__.load({
	id: "dsh-plugin-structured-prompt",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared/format.ts
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
		/**
		* 取某个格式类型的骨架。
		*
		* 用 `Object.hasOwn` 查表而不是直接下标取值：越界的格式类型（模型传了 schema 外的值、
		* 或旧表单里的历史值）下标取值会得到 `undefined`，被后续 `join` 折叠成空串，于是整个
		* 输出格式段静默少一段。查不到就明确返回空串，并由调用方决定是否拒绝该输入。
		* @param format - 格式类型。
		* @returns 骨架文本；空串或越界值返回空串。
		*/
		function resolveSkeleton(format) {
			if (!Object.hasOwn(OUTPUT_FORMAT_SKELETONS, format)) return "";
			return OUTPUT_FORMAT_SKELETONS[format];
		}
		/**
		* 判断格式说明与格式类型的关系。
		*
		* 存在的意义是让界面能说出"格式类型已经被说明覆盖了"。没有这个提示时，用户改选格式
		* 类型后看到的是一段与选择不符的契约，而界面仍然高亮着新值 —— 两边静默分叉
		* （`applyFormatChoice` 只负责在切换时同步骨架，管不到"用户手写后再改选"的语义）。
		* @param spec - 格式说明。
		* @param format - 所选格式类型。
		* @returns 关系状态。
		*/
		function formatSpecStatus(spec, format) {
			const trimmed = spec.trim();
			if (trimmed === "") return "empty";
			const skeleton = resolveSkeleton(format);
			if (skeleton === "") return "detached";
			if (trimmed === skeleton) return "matches";
			if (trimmed.startsWith(skeleton)) return "extends";
			return "detached";
		}
		/**
		* 按新选的格式类型更新「输出格式说明」。
		*
		* 客户端选格式时会把骨架写进说明字段供用户接着编辑，因此说明可能处于三种状态：
		*  - 空、或恰好是某套骨架：整段替换；
		*  - 在某套骨架基础上追加过内容：**只替换骨架部分**，保留追加的内容；
		*  - 完全手写：不动 —— 说明才是最终契约，此时格式类型不再影响产物。
		*
		* 中间那条是关键：早先"已被手写就完全不覆盖"的规则会让用户改选格式后，产物里仍是
		* 旧格式的契约（格式类型在 UI 上已高亮为新值），两边静默分叉。
		* @param current - 当前的格式说明。
		* @param format - 新选的格式类型；空串表示清除选择。
		* @returns 更新后的格式说明。
		*/
		function applyFormatChoice(current, format) {
			const skeleton = resolveSkeleton(format);
			if (skeleton === "") return current;
			const trimmed = current.trim();
			const known = Object.values(OUTPUT_FORMAT_SKELETONS);
			if (trimmed === "" || known.includes(trimmed)) return skeleton;
			const previous = known.find((item) => trimmed.startsWith(item));
			return previous === void 0 ? current : skeleton + trimmed.slice(previous.length);
		}
		/** `toolPolicy` 的合法取值。 */
		const TOOL_POLICY_VALUES = [
			"",
			"auto",
			"manual"
		];
		/** `outputFormat` 的合法取值：骨架表的键就是权威来源，避免两份清单漂移。 */
		const OUTPUT_FORMAT_VALUES = ["", ...Object.keys(OUTPUT_FORMAT_SKELETONS)];
		/**
		* 每个字段的运行时形状。
		*
		* 两处共用同一份定义：导入 JSON 文档的校验（本文件），以及内置模板库对
		* `templates.json` 的校验（`templates.ts`）—— 后者同样是文件边界，坏数据在**模块加载期**就报出来。
		*
		* 用 `satisfies Record<keyof PromptForm, string>` 约束：`PromptForm` 增删字段时这里
		* 会直接编译失败，不会悄悄漏掉一个字段的校验。
		*/
		const FIELD_SHAPES = {
			role: "string",
			goal: "string",
			background: "string",
			successCriteria: "string",
			rules: "string[]",
			forbidden: "string[]",
			toolPolicy: "tool-policy",
			callableTools: "string[]",
			toolSlots: "string[]",
			toolGuidance: "string[]",
			toolFailure: "string",
			outputSpec: "string",
			outputFormat: "output-format",
			languageTone: "string",
			fields: "string[]",
			fallback: "string",
			examples: "string"
		};
		/**
		* 空白表单：所有数组为空、所有文本为空，保证「未填写」与「空串」一致。
		* @returns 全新的空白表单。
		*/
		function createEmptyForm() {
			return {
				role: "",
				goal: "",
				background: "",
				successCriteria: "",
				rules: [],
				forbidden: [],
				toolPolicy: "",
				callableTools: [],
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
		* 用片段补全成完整表单。
		*
		* 模板与 JSON 导入都只提供部分字段，缺省项由空白表单补齐 —— 这样新增字段时无需
		* 逐个模板补齐，也不会因为 `undefined` 漏进渲染。
		* @param patch - 部分字段。
		* @returns 完整表单。
		*/
		function completeForm(patch) {
			return {
				...createEmptyForm(),
				...patch
			};
		}
		/**
		* 把表单序列化成带版本号的导出文档。
		* @param form - 表单字段。
		* @returns 可写进文件的文档对象。
		*/
		function serializeForm(form) {
			return {
				version: 1,
				form
			};
		}
		/**
		* 按声明的形状校验一个字段值。
		*
		* 导入 JSON 文档与内置模板库（`templates.ts`）共用它。
		* @param value - 待校验的值。
		* @param shape - 期望形状。
		* @returns 是否合法。
		*/
		function matchesShape(value, shape) {
			if (shape === "string") return typeof value === "string";
			if (shape === "string[]") return Array.isArray(value) && value.every((item) => typeof item === "string");
			if (shape === "tool-policy") return TOOL_POLICY_VALUES.includes(value);
			if (shape === "output-format") return OUTPUT_FORMAT_VALUES.includes(value);
			return false;
		}
		/**
		* 是不是可以当字段容器用的普通对象。
		* @param value - 待判断的值。
		* @returns 对象、非 `null`、非数组时为 `true`。
		*/
		function isPlainObject(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		/**
		* 解析导入的表单文档。
		*
		* 接受两种输入：
		*  - 本版本导出的文档 `{ version, form }`；
		*  - 早期版本直接导出的**裸表单**（没有 `version`，按最初版本解析）。
		*
		* 只保留已知字段并逐字段校验形状：未知键、类型不符、越界枚举都会被丢弃并记进
		* `warnings`，而不是混进表单。用户手改 JSON 是常见操作，静默接受坏值会让问题推迟
		* 到构建提示词时才暴露。
		* @param text - 文件内容。
		* @returns 表单片段与被忽略内容的说明。
		* @throws {Error} 内容不是合法 JSON、或顶层不是对象时。
		*/
		function parseFormDocument(text) {
			let raw;
			try {
				raw = JSON.parse(text);
			} catch {
				throw new Error("不是合法的 JSON");
			}
			if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("顶层必须是对象");
			const warnings = [];
			const record = raw;
			let source = record;
			if ("version" in record) {
				const version = record["version"];
				if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new Error("version 必须是正整数");
				if (version > 1) warnings.push(`文档版本 ${version} 比本插件支持的 1 新，未识别的字段会被忽略`);
				const inner = record["form"];
				if (typeof inner !== "object" || inner === null || Array.isArray(inner)) throw new Error("form 必须是对象");
				source = inner;
			} else if (isPlainObject(record["form"])) {
				warnings.push("缺少版本号：已按 form 字段的内容解析");
				source = record["form"];
			} else warnings.push("这是没有版本号的旧导出文件，已按最初版本解析");
			const patch = {};
			for (const [key, value] of Object.entries(source)) {
				const shape = FIELD_SHAPES[key];
				if (shape === void 0) {
					warnings.push(`忽略未知字段 ${key}`);
					continue;
				}
				if (!matchesShape(value, shape)) {
					warnings.push(`忽略字段 ${key}：取值不符合 ${shape}`);
					continue;
				}
				patch[key] = value;
			}
			return {
				patch,
				warnings
			};
		}
		//#endregion
		//#region src/shared/library.ts
		/**
		* 上游记录 id 是否可以直接拼进 URL 路径。
		*
		* 这道校验是**安全边界**：id 由界面回传，不校验就拼进上游 URL 等于把路径注入的口子交出去
		* （`../`、`?`、`#` 都能改变实际请求的地址）。
		* @param id - 待校验的 id。
		* @returns 只含字母、数字与 `-`/`_` 且长度合理时为 `true`。
		*/
		function isValidItemId(id) {
			return /^[A-Za-z0-9_-]{1,64}$/.test(id);
		}
		/**
		* 取字符串字段。
		* @param value - 上游字段值。
		* @returns 字符串本身；否则空串（界面渲染空而不是 `undefined`）。
		*/
		function text(value) {
			return typeof value === "string" ? value : "";
		}
		/**
		* 上游记录里的作者名。
		* @param record - 上游记录。
		* @returns 作者名；上游不给时为空串。
		*/
		function authorOf(record) {
			const author = record["author"];
			if (typeof author !== "object" || author === null) return "";
			return text(author["username"]);
		}
		/**
		* 把上游一条记录映射成列表项。
		* @param raw - 上游记录（形状未经校验）。
		* @returns 列表项；不是对象或 `id` 不合法时为 `undefined`。
		*/
		function mapItem(raw) {
			if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
			const record = raw;
			const id = text(record["id"]);
			if (!isValidItemId(id)) return void 0;
			return {
				id,
				title: text(record["title"]),
				description: text(record["description"]),
				author: authorOf(record)
			};
		}
		/**
		* 把上游一条记录映射成详情。
		* @param raw - 上游记录。
		* @returns 详情；`id` 不合法或 `content` 缺失时为 `undefined`。
		*/
		function mapDetail(raw) {
			const item = mapItem(raw);
			if (item === void 0) return void 0;
			const content = text(raw["content"]);
			if (content === "") return void 0;
			return {
				...item,
				content
			};
		}
		/**
		* 把上游的列表响应映射成检索结果。
		*
		* 逐条过滤而不是整份拒绝：上游里混进一条形状不对的记录，不该让整次检索失败。
		* @param raw - 上游响应体。
		* @returns 检索结果；形状完全不符时给出空结果。
		*/
		function mapSearchResponse(raw) {
			if (typeof raw !== "object" || raw === null) return {
				items: [],
				total: 0
			};
			const record = raw;
			return {
				items: (Array.isArray(record["prompts"]) ? record["prompts"] : []).map(mapItem).filter((item) => item !== void 0),
				total: typeof record["total"] === "number" && Number.isFinite(record["total"]) ? record["total"] : 0
			};
		}
		/**
		* 检索弹窗的初始状态。
		*
		* 与表单的 `createEmptyForm()` 对称：store 的初始态由这里给，避免这份字段清单在两处各写一份。
		* @returns 全新的初始状态。
		*/
		function createLibraryState() {
			return {
				active: false,
				query: "",
				status: "idle",
				items: [],
				total: 0,
				failure: "",
				selectedId: "",
				detail: null,
				detailStatus: "idle"
			};
		}
		//#endregion
		//#region src/client/store.ts
		/**
		* 结构化输入任务的会话状态。
		*
		* 两个槽位注册共用同一个 store 句柄：入口按钮（`conversation.input.left`）切换开关，
		* 弹窗（`conversation.input.dock`）按开关渲染 —— 表单与提示词库检索**互斥**，同时只开一个。
		* 实例由 Slot 渲染器按「handle × sessionId」缓存，因此几处共享同一实例，不需要跨注册的状态
		* 同步。
		*
		* 工具名与用途**按索引配对**（`callableTools[i]` ↔ `toolSlots[i]`），所以增删必须
		* 成对操作；`addTool` / `removeTool` 是唯一的成对入口，避免两个数组长度错位。
		*/
		/**
		* 初始会话状态。
		*
		* 默认只展开「基础信息」，其余三组折叠 —— 避免表单一打开就铺满屏幕。
		* @returns 全新的初始状态。
		*/
		function emptyState() {
			return {
				active: false,
				form: createEmptyForm(),
				collapsed: [
					"rules",
					"tools",
					"output"
				],
				appliedTemplate: "",
				library: createLibraryState()
			};
		}
		/**
		* 声明结构化输入任务的 store。
		* @returns store 句柄，写集覆盖整表替换、字段写入、数组条目增删改序、分组折叠与检索弹窗状态。
		*/
		function createStructuredInputStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: emptyState,
				actions: {
					open: (draft) => {
						draft.active = true;
						draft.library.active = false;
					},
					close: (draft) => {
						draft.active = false;
					},
					openLibrary: (draft) => {
						draft.library.active = true;
						draft.active = false;
					},
					closeLibrary: (draft) => {
						draft.library.active = false;
					},
					patchLibrary: (draft, patch) => {
						Object.assign(draft.library, patch);
					},
					setForm: (draft, form) => {
						draft.form = completeForm(form);
					},
					setField: (draft, key, value) => {
						draft.form[key] = value;
					},
					addItem: (draft, key, value) => {
						draft.form[key].push(value);
					},
					setItem: (draft, key, index, value) => {
						if (index < 0 || index >= draft.form[key].length) return;
						draft.form[key][index] = value;
					},
					removeItem: (draft, key, index) => {
						if (index < 0 || index >= draft.form[key].length) return;
						draft.form[key].splice(index, 1);
					},
					moveItem: (draft, key, index, delta) => {
						const items = draft.form[key];
						const next = index + delta;
						if (index < 0 || index >= items.length || next < 0 || next >= items.length) return;
						const moved = items.splice(index, 1)[0];
						if (moved === void 0) return;
						items.splice(next, 0, moved);
					},
					addTool: (draft) => {
						draft.form.callableTools.push("");
						draft.form.toolSlots.push("");
					},
					removeTool: (draft, index) => {
						const count = draft.form.callableTools.length;
						if (index < 0 || index >= count) return;
						draft.form.callableTools.splice(index, 1);
						draft.form.toolSlots.splice(index, 1);
					},
					toggleSection: (draft, id) => {
						const at = draft.collapsed.indexOf(id);
						if (at >= 0) draft.collapsed.splice(at, 1);
						else draft.collapsed.push(id);
					},
					setAppliedTemplate: (draft, id) => {
						draft.appliedTemplate = id;
					},
					reset: (draft) => {
						draft.form = createEmptyForm();
						draft.appliedTemplate = "";
					}
				}
			});
		}
		//#endregion
		//#region src/shared/templates.json
		var templates_default = {
			version: 1,
			templates: [
				{
					"id": "alert-triage",
					"label": "告警研判（原始示例）",
					"whenToUse": "线上告警要不要人工介入、先查什么",
					"fields": {
						"role": "你是一名负责线上稳定性的 SRE 助手，服务于一个日订单量百万级的电商系统。",
						"goal": "根据监控数据判断告警是否需要人工立即介入，并给出首要排查方向。",
						"rules": [
							"只能基于工具返回的数据下结论，不得引用记忆中其他系统的经验值。",
							"所有数值必须带上单位和时间窗口，例如 940ms / 近 5 分钟。",
							"阈值判断必须以指标配置为准；配置缺失时明确说明缺失，不要用默认值代替。"
						],
						"forbidden": ["不得输出任何猜测性的根因结论（例如“疑似数据库慢查询”）。"],
						"toolPolicy": "auto",
						"toolGuidance": ["先调用 query_metrics 拿指标，再调用 get_threshold_config 拿阈值，顺序不可颠倒。", "如果指标数据的时间窗口与阈值配置不一致，先调用 list_metric_windows 确认可用窗口。"],
						"toolFailure": "任何一次工具调用失败，最多重试一次；仍失败则直接报告失败，不要用估计值代替。",
						"outputFormat": "json",
						"fields": [
							"severity: \"P0\" | \"P1\" | \"P2\" | \"info\"",
							"metric: { name, value, unit, window }",
							"threshold: { value, unit, source } 或 null",
							"breached: boolean",
							"first_checks: string[]  // 1-3 条首要排查方向",
							"data_gaps: string[]     // 缺失的数据项，没有则空数组"
						],
						"fallback": "若关键指标或阈值任一缺失，severity 返回 \"info\"，并在 data_gaps 中列出缺失项。禁止编造数值。"
					}
				},
				{
					"id": "code-review",
					"label": "代码审查",
					"whenToUse": "审查一处改动，找缺陷并排序",
					"fields": {
						"role": "你是一名严格的高级工程师，负责对提交的改动做缺陷导向的代码审查。",
						"goal": "找出改动中会导致线上故障、数据错误或安全问题的缺陷，并按严重度排序。",
						"successCriteria": "每条结论都能指向具体文件与代码位置；没有发现缺陷时明确说明。",
						"rules": ["只审查本次改动涉及的范围，不扩展评审范围。", "每条问题必须给出文件路径与行号。"],
						"forbidden": ["不得提出纯粹的风格偏好（命名、空行、注释密度）。"],
						"toolPolicy": "auto",
						"toolGuidance": ["先读取改动范围内的文件，再下结论。"],
						"toolFailure": "读取失败时明确说明哪些文件未能读取，不要凭猜测补充内容。",
						"outputFormat": "json",
						"languageTone": "简洁直接，中文，不写客套话。",
						"fields": [
							"severity: \"blocker\" | \"major\" | \"minor\"",
							"file: string",
							"line: number",
							"problem: string",
							"suggestion: string"
						],
						"fallback": "若无法获取完整改动内容，返回空数组并在 summary 中说明原因。"
					}
				},
				{
					"id": "data-extract",
					"label": "数据提取",
					"whenToUse": "把非结构化文本抽成可入库的结构化记录",
					"fields": {
						"role": "你是一名数据抽取助手，把非结构化文本转换为结构化记录。",
						"goal": "从输入文本中抽取指定字段，输出可直接入库的记录。",
						"successCriteria": "每条记录字段齐全且与原文一致。",
						"rules": ["字段值必须逐字来自原文，不得改写或补全。"],
						"forbidden": ["不得编造原文中不存在的字段值。"],
						"toolPolicy": "auto",
						"outputFormat": "json",
						"fields": ["records: object[]  // 每条记录一条"],
						"fallback": "字段在原文中缺失时填 null，并在 missing 数组中列出字段名。禁止编造。"
					}
				},
				{
					"id": "report",
					"label": "报告撰写",
					"whenToUse": "把已有材料整理成结论先行的简报",
					"fields": {
						"role": "你是一名技术分析师，把已有材料整理成可决策的报告。",
						"goal": "基于给定材料输出一份结论先行、依据可追溯的简报。",
						"successCriteria": "读者能在第一段拿到结论与建议。",
						"rules": ["结论必须由给出的材料支撑，不引入材料之外的事实。"],
						"forbidden": ["不得虚构数据、时间或引用来源。"],
						"toolPolicy": "auto",
						"outputFormat": "markdown",
						"languageTone": "中文，面向管理者，控制在一页内。",
						"fallback": "材料不足以支撑某项结论时，在「待确认」一节列出，不要给出推测值。"
					}
				},
				{
					"id": "explore",
					"label": "探索调研",
					"whenToUse": "读多写少地搞清某个仓库、系统或资料的现状",
					"fields": {
						"role": "你是一名资深工程师，负责把一处陌生的代码或系统现状查清楚。",
						"goal": "用最小代价给出该范围内的现状结论，并标注不确定的部分。",
						"successCriteria": "读者能按结论里的路径直接找到对应代码或资料。",
						"rules": [
							"先读后结论：每条结论都要指向具体文件与行号，或具体来源。",
							"把「已确认」「推测」「未查」分开写，不确定就说不确定。",
							"先用搜索与目录列举定位，再按需读取片段，不要整文件通读。"
						],
						"forbidden": ["不得根据文件名、目录结构或既有印象推测实现细节。", "本轮不改动任何文件。"],
						"toolPolicy": "auto",
						"outputFormat": "markdown",
						"fields": [
							"结论（按重要性排序）",
							"证据：文件:行 或 来源",
							"未解疑问与需要确认的点"
						],
						"fallback": "材料不足以支撑某项结论时，把它列进「未解疑问」，不要用推测填充。"
					}
				},
				{
					"id": "implement",
					"label": "实现改动",
					"whenToUse": "按已定方案落地一处代码改动",
					"fields": {
						"role": "你是一名注重工程质量的实现者，按给定方案落地改动。",
						"goal": "完成目标改动，并用仓库自己的验证证明它能工作。",
						"successCriteria": "改动可独立回溯，且验证命令是真实执行过的。",
						"rules": [
							"最小改动：只碰与目标直接相关的代码，不顺手重构无关部分。",
							"复用仓库里既有的模式与工具函数，不引入新的运行时依赖。",
							"改完跑该仓库自己的验证（测试 / 类型检查 / 构建），把命令与结果写出来。"
						],
						"forbidden": ["不得为了让验证通过而放宽或删除既有断言，也不得跳过验证直接宣布完成。"],
						"toolPolicy": "auto",
						"outputFormat": "markdown",
						"fields": [
							"改了什么（文件:行）",
							"为什么这么改",
							"验证方式与结果（命令 + 结果）",
							"遗留风险或未覆盖的部分"
						],
						"fallback": "做不完时有两条出路：说明缺什么，或交付最小可行子集并明确标注未完成的部分。"
					}
				},
				{
					"id": "debug",
					"label": "故障定位",
					"whenToUse": "定位一个具体故障或异常行为",
					"fields": {
						"role": "你是一名负责定位线上与本地故障的工程师。",
						"goal": "找出该故障的根因，或明确说明当前证据不足以定论。",
						"successCriteria": "每条结论都绑定证据；无法定论时给出下一步需要的信息。",
						"rules": [
							"先复现再定位：没有复现就说清缺什么信息，不要跳到猜测。",
							"区分现象、假设与结论，结论必须绑定证据（日志、复现步骤或代码位置）。",
							"确认根因之前不要改代码。"
						],
						"forbidden": ["没有证据时不得给出根因结论。"],
						"toolPolicy": "auto",
						"outputFormat": "json",
						"fields": [
							"symptom: string",
							"root_cause: string 或 null",
							"evidence: string[]  // 日志片段、复现步骤或代码位置",
							"fix: string 或 null",
							"confidence: \"confirmed\" | \"likely\" | \"unconfirmed\""
						],
						"fallback": "无法复现或证据不足时 root_cause 返回 null，并在 evidence 里列出还需要哪些信息。不要用猜测填补。"
					}
				},
				{
					"id": "handoff",
					"label": "交接归档",
					"whenToUse": "把已完成的工作整理成可交接的状态",
					"fields": {
						"role": "你是一名负责把工作交接清楚的工程师。",
						"goal": "把当前进展整理成接手者能直接继续的说明。",
						"successCriteria": "接手者读完能知道下一步做什么，并能核对每条结论的产物。",
						"rules": ["只写已确认的事实，区分「已完成」「进行中」「未开始」。", "每条结论指向可核对的产物：文件路径、提交、命令输出。"],
						"forbidden": ["不得把计划或打算写成已完成。"],
						"toolPolicy": "auto",
						"outputFormat": "markdown",
						"languageTone": "中文，面向接手者，不写客套话。",
						"fields": [
							"已完成（含产物路径）",
							"为什么这么做",
							"剩下什么",
							"接手的人怎么继续：第一步做什么"
						],
						"fallback": "有信息缺口时明确列出缺少什么，不要用推测补全。"
					}
				}
			]
		};
		//#endregion
		//#region src/shared/templates.ts
		/**
		* 内置模板库：填充的是**表单字段**，不是成稿提示词。
		*
		* 数据在 `templates.json` —— **单一真源**：客户端表单的模板下拉、host 工具的 `template`
		* 枚举、以及黄金样本都从它来。改一套模板只动 JSON，不必碰代码，也就没有"两份清单各自漂移"
		* 的机会。第一套 `alert-triage` 是本插件最初的那份示例（用来验证生成结果与原始实现一致）。
		*
		* 两个半边都把它打包进自己的产物：打包器会把 JSON 内联成字面量（实测 host / client 产物都
		* 没有外部引用），因此 host 半边「零 import」的约束不受影响。
		*
		* JSON 是**文件边界**：这里按 `forms.ts` 的字段形状校验一次，形状不对就抛错，而不是把坏值
		* 塞进表单。校验与导入 JSON 文档共用同一份 `FIELD_SHAPES`。
		*/
		/**
		* 把 JSON 片段收窄成表单片段。
		*
		* 模板是仓库自己的数据，写错就该立刻炸：未知字段、类型不符、越界枚举都在这里拦下。
		* @param fields - JSON 里的字段片段。
		* @param id - 模板 id（只用于错误信息）。
		* @returns 通过校验的表单片段。
		* @throws {Error} 字段名或取值不符合 `PromptForm` 的形状时。
		*/
		function toTemplateFields(fields, id) {
			const patch = {};
			for (const [key, value] of Object.entries(fields)) {
				const shape = FIELD_SHAPES[key];
				if (shape === void 0) throw new Error(`template "${id}": unknown form field "${key}"`);
				if (!matchesShape(value, shape)) throw new Error(`template "${id}": field "${key}" is not ${shape}`);
				patch[key] = value;
			}
			return patch;
		}
		const RAW = templates_default;
		for (const entry of RAW.templates) toTemplateFields(entry.fields, entry.id);
		/**
		* 内置模板库。
		*
		* `build()` 把字段片段补全成完整表单（缺省项为空），交给 store 的 `setForm`。
		*/
		const TEMPLATES = RAW.templates.map((entry) => ({
			id: entry.id,
			label: entry.label,
			whenToUse: entry.whenToUse,
			build: () => completeForm(toTemplateFields(entry.fields, entry.id))
		}));
		/**
		* 按 id 取模板。
		*
		* **唯一的 id 解析点**：模板下拉、套用后的场景条、host 侧的构建都从这里取。集中一处
		* 是为了让"再加一层模板来源"（例如本机自定义模板）只需要改这个函数，而不是在每个调用
		* 点各查一遍 `TEMPLATES`。
		* @param id - 模板 id；空串按未指定处理。
		* @returns 模板；未找到时为 `undefined`。
		*/
		function findTemplate(id) {
			if (id === "") return void 0;
			return TEMPLATES.find((template) => template.id === id);
		}
		//#endregion
		//#region src/client/ui/theme.ts
		/** 主题 token（均带回退值，token 缺失时仍可读）。 */
		const COLORS = {
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
			danger: "var(--dsw-alias-state-error-primary, #e5484d)"
		};
		/** 输入框底部工具栏里的入口按钮（与计划/权限控件同一行）。 */
		const triggerButtonStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 5,
			height: 24,
			padding: "0 8px",
			border: `1px solid ${COLORS.border}`,
			borderRadius: 8,
			background: "transparent",
			color: COLORS.textSecondary,
			font: "inherit",
			fontSize: 12,
			lineHeight: 1,
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		//#endregion
		//#region src/client/ui/styles.ts
		/** 弹窗遮罩：不绑定点击关闭（见 `Modal.tsx` 的说明）。 */
		const maskStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 40,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 24,
			boxSizing: "border-box",
			background: COLORS.mask,
			backdropFilter: COLORS.maskBlur
		};
		/** 弹窗本体：固定宽度、高度由内容决定、最多占窗口 70%。 */
		const modalStyle = {
			display: "flex",
			flexDirection: "column",
			width: "clamp(600px, 74vw, 900px)",
			maxWidth: "100%",
			maxHeight: "70vh",
			border: 0,
			borderRadius: 16,
			background: COLORS.surface,
			boxShadow: COLORS.shadow,
			color: COLORS.text,
			fontSize: 13,
			overflow: "hidden"
		};
		/** 标题栏：标题 + 必填提示 + 右上角关闭。 */
		const modalHeadStyle = {
			display: "flex",
			alignItems: "center",
			gap: 10,
			flexWrap: "wrap",
			flex: "none",
			padding: "12px 16px",
			borderBottom: `1px solid ${COLORS.border}`
		};
		/** 弹窗内容区 —— 唯一的滚动容器（见文件头第 3 条不变量）。 */
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
			borderTop: `1px solid ${COLORS.border}`
		};
		/** 分组容器（见文件头第 1、2 条不变量）。 */
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
			borderBottom: `1px solid ${COLORS.border}`,
			background: "transparent",
			color: COLORS.textSecondary,
			font: "inherit",
			fontSize: 12,
			fontWeight: 600,
			letterSpacing: "0.02em",
			cursor: "pointer",
			textAlign: "left"
		};
		/** 分组内容区。 */
		const sectionBodyStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 14
		};
		/** 字段标签。 */
		const labelStyle = {
			display: "block",
			marginBottom: 5,
			fontSize: 12,
			color: COLORS.textSecondary
		};
		/** 必填星号。 */
		const requiredMarkStyle = {
			color: COLORS.danger,
			marginLeft: 3
		};
		/** 输入控件通用样式（文本域在此之上加自适应高度）。 */
		const inputStyle = {
			width: "100%",
			boxSizing: "border-box",
			padding: "7px 9px",
			border: `1px solid ${COLORS.border}`,
			borderRadius: 8,
			background: "transparent",
			color: "inherit",
			font: "inherit",
			fontSize: 13,
			lineHeight: 1.55,
			resize: "vertical"
		};
		/** 横向排列一行（按钮组、输入 + 操作）。 */
		const rowStyle = {
			display: "flex",
			alignItems: "center",
			gap: 6
		};
		/** 次要按钮。 */
		const buttonStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			minWidth: 26,
			height: 26,
			padding: "0 8px",
			border: `1px solid ${COLORS.border}`,
			borderRadius: 8,
			background: "transparent",
			color: "inherit",
			font: "inherit",
			fontSize: 12,
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		/** 主按钮（确认类操作）。 */
		const primaryButtonStyle = {
			...buttonStyle,
			padding: "0 14px",
			height: 30,
			border: 0,
			background: COLORS.accent,
			color: "var(--dsw-alias-label-primary-foreground, #fff)",
			fontWeight: 600
		};
		/**
		* 供注入的样式：内联样式无法覆盖的伪类与滚动条。
		*
		* 由 `src/client/index.ts` 以带标记的 `<style>` 标签注入一次（重复加载不叠加）。
		*/
		const PANEL_CSS = `
[data-structured-prompt-trigger]:hover {
  border-color: ${COLORS.borderStrong};
  color: ${COLORS.text};
}
[data-structured-prompt-modal] textarea,
[data-structured-prompt-modal] input,
[data-structured-prompt-modal] select {
  outline: none;
}
[data-structured-prompt-modal] textarea:focus,
[data-structured-prompt-modal] input:focus,
[data-structured-prompt-modal] select:focus {
  border-color: ${COLORS.accent};
}
[data-structured-prompt-modal] textarea::placeholder,
[data-structured-prompt-modal] input::placeholder {
  color: ${COLORS.caption};
}
[data-structured-prompt-modal] button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 弹窗内容区的右侧滚动条：细、无轨道、跟随主题。 */
[data-structured-prompt-modal] [data-scroll] {
  scrollbar-width: thin;
  scrollbar-color: ${COLORS.borderStrong} transparent;
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar-track {
  background: transparent;
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
  background-color: ${COLORS.borderStrong};
}
[data-structured-prompt-modal] [data-scroll]::-webkit-scrollbar-thumb:hover {
  background-color: ${COLORS.caption};
}
`;
		//#endregion
		//#region src/client/ui/base.tsx
		/**
		* 浏览器是否支持 `field-sizing: content`（文本域按内容自适应高度）。
		* 支持的浏览器不需要 JS 参与；不支持的由 `fitTextArea` 兜底。
		*
		* 只探测一次并缓存：结果在整个页面生命周期内不变。
		*/
		function supportsContentSizing() {
			if (typeof document === "undefined") return false;
			const probe = document.createElement("textarea");
			probe.style.fieldSizing = "content";
			return probe.style.fieldSizing === "content";
		}
		let contentSizing;
		/**
		* JS 兜底：把文本域高度贴合内容（上限由 {@link TEXTAREA_MAX_PX} 约束）。
		* @param element - 文本域元素。
		*/
		function fitTextArea(element) {
			if (element === null || contentSizing === true) return;
			element.style.height = "auto";
			element.style.height = `${Math.min(element.scrollHeight, 338)}px`;
		}
		/**
		* 多行文本域：高度随内容自适应，所以每条表单项都能完整展示，不会被限高。
		* @param props - 值、变更回调、占位符与无障碍名。
		* @returns 文本域元素。
		*/
		function TextArea({ value, onChange, placeholder, ariaLabel }) {
			contentSizing ??= supportsContentSizing();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
				value,
				placeholder,
				"aria-label": ariaLabel,
				style: {
					...inputStyle,
					minHeight: 58,
					maxHeight: 338,
					...contentSizing ? { fieldSizing: "content" } : {}
				},
				ref: (element) => {
					if (!contentSizing) fitTextArea(element);
				},
				onChange: (event) => {
					if (!contentSizing) fitTextArea(event.currentTarget);
					onChange(event.target.value);
				}
			});
		}
		/**
		* 单行输入。
		* @param props - 值、变更回调、占位符与无障碍名。
		* @returns 输入元素。
		*/
		function TextInput({ value, onChange, placeholder, ariaLabel }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
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
		/**
		* 带标题的字段块。
		* @param props - 标签、必填标记与控件。
		* @returns 字段块元素。
		*/
		function Field({ label, required, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				style: labelStyle,
				children: [label, required === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: requiredMarkStyle,
					children: "*"
				}) : null]
			}), children] });
		}
		/**
		* 次要按钮：统一 `type="button"` 与禁用态，避免各处重复写。
		* @param props - 回调、提示与文字。
		* @returns 按钮元素。
		*/
		function SmallButton({ onClick, title, children, ariaLabel, disabled, style }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: {
					...buttonStyle,
					...style
				},
				title,
				"aria-label": ariaLabel ?? title,
				disabled,
				onClick,
				children
			});
		}
		/**
		* 互斥选项组（chip 形式）：用于策略与输出格式这类少量枚举。
		* @param props - 选项、当前值与回调。
		* @returns chip 组元素。
		*/
		function ChipGroup({ options, value, onPick }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					...rowStyle,
					flexWrap: "wrap"
				},
				children: options.map(([optionValue, text]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: 4,
						padding: "4px 10px",
						border: `1px solid ${value === optionValue ? COLORS.accent : COLORS.border}`,
						borderRadius: 999,
						background: value === optionValue ? COLORS.accentSoft : "transparent",
						color: "inherit",
						font: "inherit",
						fontSize: 12,
						cursor: "pointer"
					},
					"aria-pressed": value === optionValue,
					onClick: () => onPick(optionValue),
					children: text
				}, optionValue === "" ? "none" : optionValue))
			});
		}
		//#endregion
		//#region src/client/ui/clipboard.ts
		/**
		* 剪贴板写入。
		*
		* 优先用异步 `navigator.clipboard`；它在非安全上下文（http 且非 localhost）或
		* 缺少用户手势时会拒绝，因此保留 `document.execCommand('copy')` 这条同步降级路径。
		* 两条都失败才返回 `false`，由调用方给出提示。
		*/
		/**
		* 把文本写入剪贴板。
		* @param text - 待复制文本。
		* @returns 是否成功写入。
		*/
		async function copyText(text) {
			if (text === "") return false;
			const clipboard = typeof navigator === "undefined" ? void 0 : navigator.clipboard;
			if (clipboard !== void 0) try {
				await clipboard.writeText(text);
				return true;
			} catch {}
			return copyTextFallback(text);
		}
		/**
		* 同步降级：临时插入一个只读文本域，选中后交给 `execCommand('copy')`。
		* @param text - 待复制文本。
		* @returns 是否成功写入。
		*/
		function copyTextFallback(text) {
			if (typeof document === "undefined") return false;
			const area = document.createElement("textarea");
			area.value = text;
			area.setAttribute("readonly", "");
			area.style.position = "fixed";
			area.style.top = "-1000px";
			area.style.opacity = "0";
			document.body.appendChild(area);
			try {
				area.select();
				return document.execCommand("copy");
			} catch {
				return false;
			} finally {
				area.remove();
			}
		}
		//#endregion
		//#region src/client/library.ts
		/**
		* 提示词库检索的客户端。
		*
		* 只依赖 `fetch` 与**同源**路径：上游 prompts.chat 不返回 CORS 头（预检返 204 却不回
		* `Access-Control-Allow-Origin`），浏览器直连会被拒；所以这里请求的是宿主注册的两条路由
		* （见 `src/host/library.ts`），由宿主代发。本模块因此**不认识上游地址** —— 那属于宿主侧
		* 的配置（`config.libraryBaseUrl`），将来换自托管实例与本模块无关。
		*/
		/** 检索路由路径（与 `src/host/library.ts` 的常量成对）。 */
		const LIBRARY_SEARCH_PATH = "/api/structured-prompt/library";
		/** 取全文的路由路径。 */
		const LIBRARY_ITEM_PATH = "/api/structured-prompt/library/item";
		/**
		* 客户端等待上限：比宿主侧的上游超时（8 秒）略长，好让宿主给出的错误说明先到，
		* 而不是客户端先抛一个没有信息的取消。
		*/
		const CLIENT_TIMEOUT_MS = 12e3;
		/**
		* 请求一条同源路由并解析 JSON。
		*
		* 失败一律归一成**可显示的说明**：宿主在响应体里给 `error` 字段时优先用它（那里写着上游
		* 到底怎么了 —— 超时、上游状态码、还是没这条记录）。
		* @param url - 同源路径（可带查询串）。
		* @param deps - 可注入的请求实现。
		* @returns 结局。
		*/
		async function requestJson(url, deps) {
			const fetchImpl = deps?.fetchImpl ?? ((input, init) => fetch(input, init));
			let response;
			try {
				response = await fetchImpl(url, {
					method: "GET",
					headers: { accept: "application/json" },
					signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS)
				});
			} catch (error) {
				return {
					ok: false,
					error: error instanceof Error && error.name === "TimeoutError" ? `宿主在 ${CLIENT_TIMEOUT_MS / 1e3} 秒内没有响应` : `无法连接宿主：${error instanceof Error ? error.message : String(error)}`
				};
			}
			let body;
			try {
				body = await response.json();
			} catch {
				return {
					ok: false,
					error: `宿主的响应不是 JSON（HTTP ${response.status}）`
				};
			}
			if (!response.ok) {
				const reported = typeof body === "object" && body !== null ? body.error : void 0;
				return {
					ok: false,
					error: typeof reported === "string" && reported !== "" ? reported : `HTTP ${response.status}`
				};
			}
			return {
				ok: true,
				value: body
			};
		}
		/**
		* 检索提示词库。
		*
		* 宿主已经把上游响应映射过一次；这里**再收敛一次**是廉价的防御 —— 界面拿到的形状因此
		* 与宿主的版本无关，上游或宿主任何一侧改了字段都不会让渲染崩掉。
		* @param query - 查询词；空串表示列上游最新的一批。
		* @param deps - 可注入的请求实现。
		* @returns 命中条目；失败时给出可显示的说明。
		*/
		async function searchLibrary(query, deps) {
			const result = await requestJson(`${LIBRARY_SEARCH_PATH}?${new URLSearchParams({
				q: query,
				limit: String(10)
			}).toString()}`, deps);
			if (!result.ok) return result;
			return {
				ok: true,
				value: mapSearchResponse(result.value)
			};
		}
		/**
		* 取一条提示词的全文。
		* @param id - 条目的 id（宿主会再校验一次，见 `isValidItemId`）。
		* @param deps - 可注入的请求实现。
		* @returns 全文；上游没有这条记录时给出说明。
		*/
		async function fetchLibraryDetail(id, deps) {
			const result = await requestJson(`${LIBRARY_ITEM_PATH}?id=${encodeURIComponent(id)}`, deps);
			if (!result.ok) return result;
			const detail = mapDetail(typeof result.value === "object" && result.value !== null ? result.value.item : void 0);
			return detail === void 0 ? {
				ok: false,
				error: "响应里没有这条提示词"
			} : {
				ok: true,
				value: detail
			};
		}
		//#endregion
		//#region src/client/ui/LibraryList.tsx
		/** 结果条目：整块可点，长文本换行（`buttonStyle` 是为单行按钮写的，这里要覆盖几处）。 */
		const itemStyle = {
			...buttonStyle,
			display: "block",
			width: "100%",
			height: "auto",
			padding: "8px 10px",
			textAlign: "left",
			whiteSpace: "normal"
		};
		/**
		* 列表视图。
		* @param props - 状态与回调。
		* @returns 搜索行、状态行与结果列表。
		*/
		function LibraryList({ library, actions, onSearch, onOpen }) {
			const statusLine = (() => {
				if (library.status === "searching") return "检索中…";
				if (library.status === "failed") return library.failure;
				if (library.status !== "ready") return "输入关键词后点「检索」；留空则列出最新的一批";
				if (library.items.length === 0) return "没有命中任何提示词";
				return library.total > library.items.length ? `共 ${library.total} 条，显示前 ${library.items.length} 条` : `命中 ${library.items.length} 条`;
			})();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						...rowStyle,
						gap: 8
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: "1 1 auto",
							minWidth: 0
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
							value: library.query,
							ariaLabel: "检索提示词",
							placeholder: "例如：code review、文章大纲、SQL 优化",
							onChange: (value) => actions.patchLibrary({ query: value })
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
						title: "检索提示词库",
						onClick: onSearch,
						children: "检索"
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "status",
					style: {
						margin: 0,
						fontSize: 12,
						color: library.status === "failed" ? COLORS.danger : COLORS.caption
					},
					children: statusLine
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-library-list": "",
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 6
					},
					children: library.items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						"data-library-item": item.id,
						style: itemStyle,
						title: "查看全文",
						onClick: () => onOpen(item.id),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									display: "block",
									fontWeight: 600
								},
								children: item.title === "" ? "(无标题)" : item.title
							}),
							item.description === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									display: "block",
									fontSize: 12,
									color: COLORS.textSecondary,
									marginTop: 2
								},
								children: item.description
							}),
							item.author === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									display: "block",
									fontSize: 11,
									color: COLORS.caption,
									marginTop: 2
								},
								children: `@${item.author}`
							})
						]
					}, item.id))
				})
			] });
		}
		//#endregion
		//#region src/client/ui/LibraryModal.tsx
		/**
		* 提示词库检索弹窗（`conversation.input.dock` 的第二个视图）。
		*
		* 与表单弹窗**互斥**，且与构建器完全隔离：检索到的是别人的成品提示词 —— 不做字段校验、
		* 不填进表单。这里只做三件事：检索、预览、发送（或复制）。列表视图在 `LibraryList.tsx`，
		* 拆开是为了单文件行数上限；本文件留弹窗外壳、详情视图与请求副作用。
		*
		* 请求打的是宿主注册的两条**同源**路由（上游没有 CORS 头，浏览器直连会被拒），所以本组件
		* 只认识路径，不认识上游地址 —— 界面文案因此也**不写死上游域名**（`config.libraryBaseUrl`
		* 可以指向自托管实例）。发送走与表单成稿**同一条**链路（宿主的 `onSend`）。
		*/
		/** 次要说明文字。 */
		const captionStyle = {
			margin: 0,
			fontSize: 12,
			color: COLORS.caption
		};
		/** 原文预览：按内容换行、可横向滚动（原文里可能有长行与表格）。 */
		const contentStyle = {
			margin: 0,
			padding: "10px 12px",
			border: `1px solid ${COLORS.border}`,
			borderRadius: 8,
			background: "transparent",
			color: "inherit",
			font: "inherit",
			fontSize: 12,
			lineHeight: 1.6,
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
			overflowX: "auto"
		};
		/**
		* 提示词库弹窗。
		* @param props - 状态、动作与回调。
		* @returns 弹窗元素。
		*/
		function LibraryModal({ library, actions, onClose, onSend }) {
			const [copied, setCopied] = (0, react.useState)(false);
			const searchSeq = (0, react.useRef)(0);
			const detailSeq = (0, react.useRef)(0);
			const detail = library.detail;
			const inDetail = library.selectedId !== "";
			/** 检索：状态先落到 store（界面据此显示"检索中"），结果或失败再落一次。 */
			const runSearch = () => {
				searchSeq.current += 1;
				const seq = searchSeq.current;
				actions.patchLibrary({
					status: "searching",
					failure: "",
					items: [],
					total: 0,
					selectedId: "",
					detail: null,
					detailStatus: "idle"
				});
				searchLibrary(library.query).then((result) => {
					if (seq !== searchSeq.current) return;
					if (result.ok) actions.patchLibrary({
						status: "ready",
						items: [...result.value.items],
						total: result.value.total
					});
					else actions.patchLibrary({
						status: "failed",
						failure: result.error,
						items: [],
						total: 0
					});
				});
			};
			/**
			* 打开一条提示词的全文。
			* @param id - 条目 id。
			*/
			const openDetail = (id) => {
				detailSeq.current += 1;
				const seq = detailSeq.current;
				setCopied(false);
				actions.patchLibrary({
					selectedId: id,
					detail: null,
					detailStatus: "searching",
					failure: ""
				});
				fetchLibraryDetail(id).then((result) => {
					if (seq !== detailSeq.current) return;
					if (result.ok) actions.patchLibrary({
						detailStatus: "ready",
						detail: result.value
					});
					else actions.patchLibrary({
						detailStatus: "failed",
						failure: result.error
					});
				});
			};
			/** 回到列表视图（保留上次的检索结果，并使在途的详情响应作废）。 */
			const backToList = () => {
				detailSeq.current += 1;
				setCopied(false);
				actions.patchLibrary({
					selectedId: "",
					detail: null,
					detailStatus: "idle",
					failure: ""
				});
			};
			/** 复制原文到剪贴板。 */
			const copyContent = () => {
				if (detail === null) return;
				copyText(detail.content).then((ok) => setCopied(ok));
			};
			/** 发送原文并关闭弹窗（与表单成稿走同一条发送链路）。 */
			const send = () => {
				if (detail === null) return;
				onSend(detail.content);
				onClose();
			};
			const detailView = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...rowStyle,
					gap: 8
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
					title: "返回检索结果",
					onClick: backToList,
					children: "← 返回"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						fontWeight: 600,
						minWidth: 0,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap"
					},
					children: detail === null ? "" : detail.title === "" ? "(无标题)" : detail.title
				})]
			}), library.detailStatus === "searching" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				role: "status",
				style: captionStyle,
				children: "读取全文…"
			}) : library.detailStatus === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				role: "status",
				style: {
					...captionStyle,
					color: COLORS.danger
				},
				children: library.failure
			}) : detail === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				role: "status",
				style: captionStyle,
				children: "这条提示词没有可显示的内容"
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [detail.description === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: captionStyle,
				children: detail.description
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
				"data-library-content": "",
				style: contentStyle,
				children: detail.content
			})] })] });
			const detailReady = library.detailStatus === "ready" && detail !== null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: maskStyle,
				role: "presentation",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-structured-prompt-library": "",
					style: modalStyle,
					role: "dialog",
					"aria-modal": true,
					"aria-label": "提示词库",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: modalHeadStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									...rowStyle,
									flex: "1 1 auto",
									minWidth: 0
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 14,
										fontWeight: 600
									},
									children: "提示词库"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										color: COLORS.caption,
										fontSize: 12
									},
									children: inDetail ? "原文预览：未经本插件整理，直接发送的就是这段文本" : "检索公共提示词库里的提示词"
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
								title: "关闭（不改动输入框内容）",
								ariaLabel: "关闭",
								style: {
									minWidth: 28,
									padding: "0 6px",
									fontSize: 14,
									lineHeight: 1
								},
								onClick: onClose,
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-scroll": "",
							style: modalBodyStyle,
							children: inDetail ? detailView : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibraryList, {
								library,
								actions,
								onSearch: runSearch,
								onOpen: openDetail
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: modalFootStyle,
							children: detailReady ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: captionStyle,
								children: copied ? "已复制到剪贴板" : "来自提示词库的原文，未经本插件整理"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									...rowStyle,
									flexWrap: "wrap"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
									title: "复制原文到剪贴板",
									onClick: copyContent,
									children: "复制"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: primaryButtonStyle,
									title: "把这段原文作为一条用户消息发送进当前会话",
									onClick: send,
									children: "发送原始提示词"
								})]
							})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: captionStyle,
								children: "来源：公共提示词库（请求由宿主代发，浏览器不直连）"
							})
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/ui/CollapsibleSection.tsx
		/**
		* 一个分组。
		* @param props - 元数据、折叠状态与内容。
		* @returns 分组元素。
		*/
		function CollapsibleSection({ meta, collapsed, onToggle, children }) {
			const open = meta.collapsible !== true || !collapsed;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: sectionStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					style: sectionHeadStyle,
					"aria-expanded": open,
					onClick: () => {
						if (meta.collapsible === true) onToggle();
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: meta.title }), meta.collapsible === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { color: COLORS.caption },
						children: open ? "▾" : "▸"
					}) : null]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: sectionBodyStyle,
					children
				}) : null]
			});
		}
		//#endregion
		//#region src/client/ui/ModalFooter.tsx
		/**
		* 底部操作栏。
		* @param props - 动作与状态。
		* @returns 底部栏元素。
		*/
		function ModalFooter({ actions, onExport, onImportClick, importRef, onImportChange, onCopy, notice, onSend, canSend }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: modalFootStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						...rowStyle,
						flexWrap: "wrap"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							style: {
								...buttonStyle,
								padding: "0 8px",
								maxWidth: 260
							},
							value: "",
							title: "用内置模板填充表单",
							"aria-label": "用内置模板填充表单",
							onChange: (event) => {
								const picked = findTemplate(event.target.value);
								event.target.value = "";
								if (picked === void 0) return;
								actions.setForm(picked.build());
								actions.setAppliedTemplate(picked.id);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: "模板…"
							}), TEMPLATES.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: item.id,
								title: item.whenToUse,
								children: `${item.label} · ${item.whenToUse}`
							}, item.id))]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
							title: "从 JSON 导入表单（也接受无版本号的旧导出文件）",
							onClick: onImportClick,
							children: "导入"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							ref: importRef,
							type: "file",
							accept: "application/json,.json",
							hidden: true,
							onChange: onImportChange
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
							title: "导出当前表单为 JSON（含 schema 版本号）",
							onClick: onExport,
							children: "导出"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
							title: "清空全部字段",
							onClick: () => actions.reset(),
							children: "清空"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						...rowStyle,
						flexWrap: "wrap"
					},
					children: [
						notice === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							role: "status",
							style: {
								fontSize: 12,
								color: notice.kind === "ok" ? COLORS.textSecondary : COLORS.danger
							},
							children: notice.text
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
							title: canSend ? "复制构建好的提示词到剪贴板" : "身份与目标为必填",
							disabled: !canSend,
							onClick: onCopy,
							children: "复制"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: {
								...primaryButtonStyle,
								opacity: canSend ? 1 : .5,
								cursor: canSend ? "pointer" : "not-allowed"
							},
							disabled: !canSend,
							title: canSend ? "把提示词投递进当前会话" : "身份与目标为必填",
							onClick: onSend,
							children: "发送"
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/shared/tokens.ts
		/**
		* token 的粗略估算。
		*
		* 刻意不引入分词器：那会带来依赖与体积，而不同模型的分词器也各不相同 —— 提示词构建器
		* 需要的只是"这段大概多长，会不会挤占上下文"，不是精确计费。
		*
		* 估算规则：CJK 字符（含全角标点）每字 1 token，其余字符每 4 字符 1 token。对以中文
		* 为主的提示词，误差通常在两成以内。
		*/
		/**
		* 判断是否为 CJK 字符（含全角标点与全角形式）。
		* @param code - 码点。
		* @returns 是否按"每字 1 token"计。
		*/
		function isCjk(code) {
			return code >= 12288 && code <= 12351 || code >= 13312 && code <= 19903 || code >= 19968 && code <= 40959 || code >= 63744 && code <= 64255 || code >= 65280 && code <= 65519;
		}
		/**
		* 估算文本的 token 数。
		* @param text - 待估算的文本。
		* @returns 估算值（`estimateTokens('') === 0`）。
		*/
		function estimateTokens(text) {
			let cjk = 0;
			let rest = 0;
			for (const char of text) if (isCjk(char.codePointAt(0) ?? 0)) cjk += 1;
			else rest += 1;
			return cjk + Math.ceil(rest / 4);
		}
		//#endregion
		//#region src/client/ui/Preview.tsx
		/**
		* 提示词预览。
		* @param props - 已构建的提示词与分段结果。
		* @returns 可折叠的预览元素。
		*/
		function Preview({ prompt, sections }) {
			const total = estimateTokens(prompt);
			const title = prompt === "" ? "预览已构建的提示词" : `预览已构建的提示词（${prompt.length} 字 · 约 ${total} tokens）`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				style: { fontSize: 12 },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
						style: {
							cursor: "pointer",
							color: COLORS.textSecondary
						},
						children: title
					}),
					sections.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: {
							margin: "8px 0 0",
							padding: "0 0 0 16px",
							color: COLORS.textSecondary,
							lineHeight: 1.7
						},
						children: sections.map((section) => {
							const tokens = estimateTokens(section.body);
							const percent = total === 0 ? 0 : Math.round(tokens / total * 100);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: `${section.title}：${tokens} tokens（${percent}%）` }, section.title);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						style: {
							margin: "8px 0 0",
							maxHeight: 260,
							overflow: "auto",
							padding: 10,
							border: `1px solid ${COLORS.border}`,
							borderRadius: 8,
							whiteSpace: "pre-wrap",
							fontSize: 12,
							lineHeight: 1.55
						},
						children: prompt === "" ? "（尚未填写身份与目标）" : prompt
					})
				]
			});
		}
		//#endregion
		//#region src/client/ui/config.ts
		/**
		* 四个分组。基础信息常开，其余三组默认折叠但可展开。
		*
		* `id` 同时是折叠状态的键，必须与 store 初始 `collapsed` 里的取值一致。
		*/
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
		const LIST_FIELDS = {
			rules: {
				key: "rules",
				label: "硬性规则（每行一条，会按 1. 2. 3. 编号）",
				placeholder: "例如：所有数值必须带上单位和时间窗口"
			},
			forbidden: {
				key: "forbidden",
				label: "禁止行为（每行一条）",
				placeholder: "例如：不得输出猜测性的根因结论"
			},
			toolGuidance: {
				key: "toolGuidance",
				label: "工具使用策略（每行一条）",
				placeholder: "例如：先调用 query_metrics 拿指标，再调用 get_threshold_config 拿阈值"
			},
			fields: {
				key: "fields",
				label: "字段级说明（每行一条）",
				placeholder: "例如：severity: \"P0\" | \"P1\" | \"P2\" | \"info\""
			}
		};
		/** 输出格式类型的 chip 选项。 */
		const OUTPUT_FORMAT_OPTIONS = [
			["", "未指定"],
			["json", "JSON"],
			["markdown", "Markdown"],
			["table", "表格"],
			["text", "纯文本"]
		];
		/** 工具调用策略的 chip 选项。 */
		const TOOL_POLICY_OPTIONS = [
			["auto", "自动（交给模型自行判断）"],
			["manual", "手动（指定要调用的工具）"],
			["", "不指定"]
		];
		//#endregion
		//#region src/client/ui/sections/BasicSection.tsx
		/**
		* 基础信息分组。
		* @param props - 表单与动作。
		* @returns 字段组。
		*/
		function BasicSection({ form, actions }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: "身份",
					required: true,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextArea, {
						value: form.role,
						ariaLabel: "身份",
						placeholder: "例如：你是一名负责线上稳定性的 SRE 助手，服务于一个日订单量百万级的电商系统。",
						onChange: (value) => actions.setField("role", value)
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: "目标",
					required: true,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextArea, {
						value: form.goal,
						ariaLabel: "目标",
						placeholder: "例如：根据监控数据判断告警是否需要人工立即介入，并给出首要排查方向。",
						onChange: (value) => actions.setField("goal", value)
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: "背景与上下文",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextArea, {
						value: form.background,
						ariaLabel: "背景与上下文",
						placeholder: "业务场景、系统规模、技术栈等（会并入「身份」段）",
						onChange: (value) => actions.setField("background", value)
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: "成功标准",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextArea, {
						value: form.successCriteria,
						ariaLabel: "成功标准",
						placeholder: "可验收的完成判据（会并入「目标」段）",
						onChange: (value) => actions.setField("successCriteria", value)
					})
				})
			] });
		}
		//#endregion
		//#region src/client/ui/ListEditor.tsx
		/**
		* 逐条编辑控件。
		* @param props - 字段元数据、条目与动作。
		* @returns 编辑器元素。
		*/
		function ListEditor({ field, items, actions }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
				label: field.label,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 6
					},
					children: [items.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: rowStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
								value: item,
								ariaLabel: `${field.label} 第 ${index + 1} 条`,
								placeholder: field.placeholder,
								onChange: (value) => actions.setItem(field.key, index, value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
								title: "上移",
								disabled: index === 0,
								onClick: () => actions.moveItem(field.key, index, -1),
								children: "↑"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
								title: "下移",
								disabled: index === items.length - 1,
								onClick: () => actions.moveItem(field.key, index, 1),
								children: "↓"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
								title: "删除这一条",
								onClick: () => actions.removeItem(field.key, index),
								children: "×"
							})
						]
					}, `item-${index}`)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
						title: "添加一条",
						style: { alignSelf: "flex-start" },
						onClick: () => actions.addItem(field.key, ""),
						children: "+ 添加一条"
					})]
				})
			});
		}
		//#endregion
		//#region src/client/ui/sections/OutputSection.tsx
		/**
		* 输出与兜底分组。
		* @param props - 表单与动作。
		* @returns 字段组。
		*/
		function OutputSection({ form, actions }) {
			const fields = LIST_FIELDS["fields"];
			const shadowed = form.outputFormat !== "" && formatSpecStatus(form.outputSpec, form.outputFormat) === "detached";
			/** 选择格式类型：同步更新说明里的骨架部分。 */
			const pickFormat = (value) => {
				actions.setField("outputFormat", value);
				actions.setField("outputSpec", applyFormatChoice(form.outputSpec, value));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: "输出格式类型",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChipGroup, {
						options: OUTPUT_FORMAT_OPTIONS,
						value: form.outputFormat,
						onPick: (value) => pickFormat(value)
					})
				}),
				shadowed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "status",
					style: {
						margin: 0,
						fontSize: 12,
						color: COLORS.caption
					},
					children: "格式类型已不生效：下面是手写的输出格式说明，它才是最终契约。"
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: "输出格式说明",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextArea, {
						value: form.outputSpec,
						ariaLabel: "输出格式说明",
						placeholder: "以 JSON 输出，字段如下：…",
						onChange: (value) => actions.setField("outputSpec", value)
					})
				}),
				fields === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListEditor, {
					field: fields,
					items: form.fields,
					actions
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: "语言与语气",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
						value: form.languageTone,
						ariaLabel: "语言与语气",
						placeholder: "例如：中文，简洁直接，面向工程师",
						onChange: (value) => actions.setField("languageTone", value)
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: "数据不足时的行为",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextArea, {
						value: form.fallback,
						ariaLabel: "数据不足时的行为",
						placeholder: "例如：若关键指标或阈值任一缺失，severity 返回 \"info\"，并在 data_gaps 中列出缺失项。禁止编造数值。",
						onChange: (value) => actions.setField("fallback", value)
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: "少样本示例",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextArea, {
						value: form.examples,
						ariaLabel: "少样本示例",
						placeholder: "给 1-2 个输入/输出对照示例",
						onChange: (value) => actions.setField("examples", value)
					})
				})
			] });
		}
		//#endregion
		//#region src/client/ui/sections/RulesSection.tsx
		/**
		* 约束与规则分组。
		* @param props - 表单与动作。
		* @returns 字段组。
		*/
		function RulesSection({ form, actions }) {
			const rules = LIST_FIELDS["rules"];
			const forbidden = LIST_FIELDS["forbidden"];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [rules === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListEditor, {
				field: rules,
				items: form.rules,
				actions
			}), forbidden === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListEditor, {
				field: forbidden,
				items: form.forbidden,
				actions
			})] });
		}
		//#endregion
		//#region src/client/ui/ToolPairEditor.tsx
		/**
		* 工具配对编辑器。
		* @param props - 表单与动作。
		* @returns 配对编辑控件。
		*/
		function ToolPairEditor({ form, actions }) {
			const names = form.callableTools;
			const slots = form.toolSlots;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
				label: "可调用的工具（工具名 + 用途）",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 6
					},
					children: [
						names.map((name, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: rowStyle,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
									value: name,
									ariaLabel: `第 ${index + 1} 个工具名`,
									placeholder: "工具名，例如 query_metrics",
									onChange: (value) => actions.setItem("callableTools", index, value)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
									value: slots[index] ?? "",
									ariaLabel: `第 ${index + 1} 个工具的用途`,
									placeholder: "用途（可留空）",
									onChange: (value) => actions.setItem("toolSlots", index, value)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
									title: "删除这一行",
									onClick: () => actions.removeTool(index),
									children: "×"
								})
							]
						}, `tool-${index}`)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
							title: "添加一个工具",
							style: { alignSelf: "flex-start" },
							onClick: () => actions.addTool(),
							children: "+ 添加一个工具"
						}),
						names.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								color: COLORS.caption,
								fontSize: 12
							},
							children: "尚未点名任何工具。手动策略下模型只被允许调用这里列出的工具。"
						}) : null
					]
				})
			});
		}
		//#endregion
		//#region src/client/ui/sections/ToolsSection.tsx
		/**
		* 工具策略分组。
		* @param props - 表单与动作。
		* @returns 字段组。
		*/
		function ToolsSection({ form, actions }) {
			const guidance = LIST_FIELDS["toolGuidance"];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: "调用工具策略",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChipGroup, {
						options: TOOL_POLICY_OPTIONS,
						value: form.toolPolicy,
						onPick: (value) => actions.setField("toolPolicy", value)
					})
				}),
				form.toolPolicy === "manual" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolPairEditor, {
					form,
					actions
				}) : null,
				guidance === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListEditor, {
					field: guidance,
					items: form.toolGuidance,
					actions
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: "工具失败时的处理",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextArea, {
						value: form.toolFailure,
						ariaLabel: "工具失败时的处理",
						placeholder: "例如：任何一次工具调用失败，最多重试一次；仍失败则直接报告失败，不要用估计值代替。",
						onChange: (value) => actions.setField("toolFailure", value)
					})
				})
			] });
		}
		//#endregion
		//#region src/shared/prompt.ts
		/**
		* 结构化提示词构建核心。
		*
		* 段落顺序与格式与原始实现一致：
		*   身份 → 目标 → 硬性规则（必须遵守，优先于其他任何要求）→ 工具使用策略
		*   → 输出格式 → 数据不足时 → 示例
		* 非空段落之间以单个空行连接，空段落整体省略；扩写字段都并入既有段落，没有
		* 新增顶层段落。
		*/
		/** 把文本按行清洗：去掉行尾空白、折叠连续空行、去首尾空行。 */
		function normalizeBlock(text) {
			return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
		}
		/** 逐条清洗数组：丢弃空白条目并去掉首尾空白。 */
		function cleanList(items) {
			return items.map((item) => item.trim()).filter((item) => item !== "");
		}
		/** 工具调用策略为「自动」时的固定引导语。 */
		const TOOL_POLICY_AUTO = "由你根据任务需要自行判断并选择要调用的工具；不需要工具时直接回答。";
		/**
		* 手动模式下按用户点名的工具生成指定调用语句。
		*
		* 工具名与用途按**原始索引**配对：用途可以留空（只写工具名），工具名留空的行
		* 整体忽略。这里刻意不先过滤数组 —— 过滤会丢掉空串、让用途与工具名错位。
		*
		* 也不做"从已安装清单里勾选"：DSH 的插件清单列的是自带插件而非用户安装的插件，
		* 工具检索属于输入框 `/` 菜单的职责，表单只负责把用户点名的工具写进提示词。
		* @param tools - 用户填写的工具名（可含空串）。
		* @param slots - 与 `tools` 索引对齐的用途说明（可含空串）。
		* @returns 策略说明文本；没有任何有效工具时返回空串。
		*/
		function manualPolicyText(tools, slots) {
			const lines = tools.map((rawTool, index) => {
				const tool = rawTool.trim();
				if (tool === "") return "";
				const purpose = (slots[index] ?? "").trim();
				return purpose === "" ? `- ${tool}` : `- ${tool}：${purpose}`;
			}).filter((line) => line !== "");
			if (lines.length === 0) return "";
			return ["只允许调用下列已指定的工具，其余工具一律不要使用：", ...lines].join("\n");
		}
		/**
		* 把分段结果拼成完整提示词。
		*
		* 与 {@link buildSystemPromptSections} 分开，是为了让调用方既能有整篇文本（发送、复制），
		* 也能拿到逐段占用（预算提示），而不必把同一份计算做两遍。
		* @param sections - 分段结果。
		* @returns 提示词全文。
		*/
		function renderPrompt(sections) {
			return sections.map((section) => `# ${section.title}\n${section.body}`).join("\n\n");
		}
		/**
		* 构建分段结果。
		*
		* 空段整体省略（`body === ''`），非空段之间以单个空行连接 —— 由 {@link renderPrompt}
		* 负责连接，这里只负责"有哪些段、每段是什么"。
		* @param form - 表单字段。
		* @returns 段落列表；身份与目标均为空时返回空数组。
		*/
		function buildSystemPromptSections(form) {
			const rules = cleanList(form.rules);
			const forbidden = cleanList(form.forbidden);
			const guidance = cleanList(form.toolGuidance);
			const fields = cleanList(form.fields);
			const identity = [normalizeBlock(form.role), normalizeBlock(form.background)].filter((text) => text !== "").join("\n");
			const success = normalizeBlock(form.successCriteria);
			const goal = [normalizeBlock(form.goal), success === "" ? "" : `完成标准：${success}`].filter((text) => text !== "").join("\n");
			const rulesBody = [rules.length === 0 ? "" : rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n"), forbidden.length === 0 ? "" : ["禁止行为（同样不可违反）：", ...forbidden.map((item) => `- ${item}`)].join("\n")].filter((text) => text !== "").join("\n");
			const policyLine = form.toolPolicy === "auto" ? TOOL_POLICY_AUTO : form.toolPolicy === "manual" ? manualPolicyText(form.callableTools, form.toolSlots) : "";
			const toolFailure = normalizeBlock(form.toolFailure);
			const guidanceBody = [
				policyLine,
				guidance.length === 0 ? "" : guidance.map((item) => `- ${item}`).join("\n"),
				toolFailure === "" ? "" : `工具失败时：${toolFailure}`
			].filter((text) => text !== "").join("\n");
			const languageTone = normalizeBlock(form.languageTone);
			const providedSpec = normalizeBlock(form.outputSpec);
			const outputBody = [
				providedSpec !== "" ? providedSpec : resolveSkeleton(form.outputFormat),
				fields.length === 0 ? "" : ["字段说明：", ...fields.map((item) => `- ${item}`)].join("\n"),
				languageTone === "" ? "" : `表达要求：${languageTone}`
			].filter((text) => text !== "").join("\n");
			const fallback = normalizeBlock(form.fallback);
			const examples = normalizeBlock(form.examples);
			return [
				{
					title: "身份",
					body: identity
				},
				{
					title: "目标",
					body: goal
				},
				{
					title: "硬性规则（必须遵守，优先于其他任何要求）",
					body: rulesBody
				},
				{
					title: "工具使用策略",
					body: guidanceBody
				},
				{
					title: "输出格式",
					body: outputBody
				},
				{
					title: "数据不足时",
					body: fallback
				},
				{
					title: "示例",
					body: examples
				}
			].filter((section) => section.body !== "");
		}
		/**
		* 必填校验：身份与目标。
		* @param form - 表单字段。
		* @returns 缺失的必填字段名；全部填写时为空数组。
		*/
		function validateForm(form) {
			const missing = [];
			if (normalizeBlock(form.role) === "") missing.push("身份");
			if (normalizeBlock(form.goal) === "") missing.push("目标");
			return missing;
		}
		//#endregion
		//#region src/client/ui/Modal.tsx
		/**
		* 表单弹窗：标题栏 + 可滚动内容区 + 底部操作栏。
		*
		* 两条不变量在这里落地（并由离线测试断言）：
		*  - 只有内容区滚动：标题栏与底部操作栏 `flex: none` 常驻，滚动条只出现在内容区
		*    右侧；
		*  - 点遮罩**不关闭**：遮罩不绑定点击处理器，避免误触丢掉已填内容；关闭只经由
		*    标题栏的 `×` 或 Esc。
		*
		* （第三条不变量在 `styles.ts`：分组容器既不裁剪也不压缩。）
		*
		* 内容区顶部在套用模板时多一条场景条（`data-applied-template`）：它是**界面陈述**，不参与提示词构建 —— 成稿只由 `form` 决定。
		*
		* 主要动作是「复制」（成稿进剪贴板）与「发送」（把成稿投递进当前会话）；不提供
		* 「同步并返回」这类中间态 —— 要么复制走，要么直接发出去。
		*/
		/** 提示的展示时长（ms）。 */
		const COPY_HINT_MS = 1800;
		/**
		* 表单弹窗。
		* @param props - 表单、折叠状态、套用标记、动作与回调。
		* @returns 弹窗元素。
		*/
		function StructuredPromptModal({ form, collapsed, applied, actions, onClose, onSend }) {
			const [notice, setNotice] = (0, react.useState)(null);
			const importRef = (0, react.useRef)(null);
			const noticeTimer = (0, react.useRef)(null);
			(0, react.useEffect)(() => () => {
				if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
			}, []);
			const sections = buildSystemPromptSections(form);
			const prompt = renderPrompt(sections);
			const missing = validateForm(form);
			const canSend = missing.length === 0 && prompt !== "";
			/**
			* 显示一次性提示。
			* @param kind - 成功或失败。
			* @param text - 提示文案。
			*/
			const showNotice = (kind, text) => {
				setNotice({
					kind,
					text
				});
				if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
				noticeTimer.current = setTimeout(() => setNotice(null), COPY_HINT_MS);
			};
			/** 复制成稿到剪贴板，并短暂显示结果。 */
			const copyPrompt = () => {
				copyText(prompt).then((ok) => {
					showNotice(ok ? "ok" : "failed", ok ? "已复制" : "复制失败");
				});
			};
			/** 发送：把成稿作为一条用户消息投递进当前会话，然后关闭弹窗。 */
			const send = () => {
				if (!canSend) return;
				onSend(prompt);
				onClose();
			};
			/** 导出当前表单为 JSON 文档（含 schema 版本号），便于在别的会话复用。 */
			const exportForm = () => {
				try {
					const text = JSON.stringify(serializeForm(form), null, 2);
					const blob = new Blob([text], { type: "application/json" });
					const url = URL.createObjectURL(blob);
					const anchor = document.createElement("a");
					anchor.href = url;
					anchor.download = "structured-prompt-form.json";
					anchor.click();
					URL.revokeObjectURL(url);
				} catch (error) {
					console.error("[structured-prompt] 导出表单失败：", error);
					showNotice("failed", "导出失败");
				}
			};
			/** 从用户选择的 JSON 文件导入表单。 */
			const importForm = (event) => {
				const file = event.target.files?.[0];
				event.target.value = "";
				if (file === void 0) return;
				file.text().then((text) => {
					try {
						const parsed = parseFormDocument(text);
						if (Object.keys(parsed.patch).length === 0) {
							showNotice("failed", "文件里没有可识别的字段，表单未改动");
							return;
						}
						actions.setForm(parsed.patch);
						actions.setAppliedTemplate("");
						if (parsed.warnings.length > 0) {
							console.warn("[structured-prompt] 导入时忽略了部分内容：", parsed.warnings);
							showNotice("ok", `已导入（忽略 ${parsed.warnings.length} 项）`);
						} else showNotice("ok", "已导入");
					} catch (error) {
						console.error("[structured-prompt] 导入表单失败：", error);
						showNotice("failed", `导入失败：${error instanceof Error ? error.message : String(error)}`);
					}
				}).catch((error) => {
					console.error("[structured-prompt] 读取文件失败：", error);
					showNotice("failed", "读取文件失败");
				});
			};
			/** 分组 id → 渲染器。新增分组时这里与 `config.ts` 的 SECTIONS 同步扩展。 */
			const renderers = {
				basic: () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BasicSection, {
					form,
					actions
				}),
				rules: () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RulesSection, {
					form,
					actions
				}),
				tools: () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolsSection, {
					form,
					actions
				}),
				output: () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OutputSection, {
					form,
					actions
				})
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: maskStyle,
				role: "presentation",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-structured-prompt-modal": "",
					style: modalStyle,
					role: "dialog",
					"aria-modal": true,
					"aria-label": "结构化输入任务",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: modalHeadStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									...rowStyle,
									flex: "1 1 auto",
									minWidth: 0
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 14,
										fontWeight: 600
									},
									children: "结构化输入任务"
								}), missing.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										color: COLORS.caption,
										fontSize: 12
									},
									children: `还差必填：${missing.join("、")}`
								}) : null]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SmallButton, {
								title: "关闭（不改动输入框内容）",
								ariaLabel: "关闭",
								style: {
									minWidth: 28,
									padding: "0 6px",
									fontSize: 14,
									lineHeight: 1
								},
								onClick: onClose,
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							"data-scroll": "",
							style: modalBodyStyle,
							children: [
								applied === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									role: "note",
									"data-applied-template": "",
									style: {
										margin: 0,
										fontSize: 12,
										color: COLORS.caption
									},
									children: `已套用模板「${applied.label}」：${applied.whenToUse}。模板里的目标是形态化的，请把本次的具体任务写进「目标」。`
								}),
								SECTIONS.map((section) => {
									const render = renderers[section.id];
									if (render === void 0) return null;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CollapsibleSection, {
										meta: section,
										collapsed: collapsed.includes(section.id),
										onToggle: () => actions.toggleSection(section.id),
										children: render()
									}, section.id);
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Preview, {
									prompt,
									sections
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModalFooter, {
							actions,
							onExport: exportForm,
							onImportClick: () => importRef.current?.click(),
							importRef,
							onImportChange: importForm,
							onCopy: copyPrompt,
							notice,
							onSend: send,
							canSend
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/ui/Panel.tsx
		/**
		* `conversation.input.dock` 的占用者：按开关渲染两个弹窗之一。
		*
		* 未打开时返回 `null` 不占空间（入口按钮由 `StructuredInputTrigger` 负责）。Esc 关闭当前
		* 打开的那个，避免困在里面。
		*
		* 发送经由宿主注入的 `onSend`：本组件不接触 `ctx`，也不假定输入框当前是否挂载
		* —— 决策与副作用都留在 `apply` 闭包里。两个弹窗共用同一条发送链路（`conversation.send`）。
		*
		* hook 顺序：`useStore` 与 `useEffect` 都必须在任何提前返回**之前**调用 —— 开关会
		* 改变渲染分支，分支之后的 hook 会让数量随状态变化而抛错。
		*/
		/**
		* 弹窗挂载点。
		* @param props - store 座位、发送回调与会话标识。
		* @returns 检索弹窗、表单弹窗，或都未打开时的 `null`。
		*/
		function StructuredInputPanel({ useStore, actions, onSend, sessionId }) {
			const active = useStore((state) => state.active);
			const form = useStore((state) => state.form);
			const collapsed = useStore((state) => state.collapsed);
			const appliedTemplate = useStore((state) => state.appliedTemplate);
			const library = useStore((state) => state.library);
			const applied = findTemplate(appliedTemplate);
			(0, react.useEffect)(() => {
				if (!active && !library.active) return void 0;
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					event.stopPropagation();
					if (library.active) actions.closeLibrary();
					else actions.close();
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => {
					window.removeEventListener("keydown", onKeyDown, true);
				};
			}, [
				active,
				library.active,
				actions
			]);
			if (sessionId === void 0) return null;
			if (library.active) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibraryModal, {
				library,
				actions,
				onClose: () => actions.closeLibrary(),
				onSend
			});
			if (!active) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StructuredPromptModal, {
				form,
				collapsed,
				applied,
				actions,
				onClose: () => actions.close(),
				onSend
			});
		}
		//#endregion
		//#region src/client/ui/Trigger.tsx
		/**
		* 入口按钮组。
		* @param props - store 座位与会话标识。
		* @returns 两个按钮（表单 / 提示词库）。
		*/
		function StructuredInputTrigger({ useStore, actions, sessionId }) {
			const active = useStore((state) => state.active);
			const libraryActive = useStore((state) => state.library.active);
			const disabled = sessionId === void 0;
			/**
			* 按钮外观：打开时高亮，无会话时降到禁用观感。
			* @param on - 该按钮对应的弹窗是否打开。
			* @returns 内联样式。
			*/
			const look = (on) => ({
				...triggerButtonStyle,
				borderColor: on ? COLORS.accent : COLORS.border,
				background: on ? COLORS.accentSoft : "transparent",
				color: on ? COLORS.text : COLORS.textSecondary,
				opacity: disabled ? .5 : 1,
				cursor: disabled ? "not-allowed" : "pointer"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 6
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"data-structured-prompt-trigger": "",
					style: look(active),
					title: "结构化输入任务：打开结构化提示词表单",
					"aria-haspopup": "dialog",
					"aria-expanded": active,
					disabled,
					onMouseDown: (event) => {
						event.preventDefault();
					},
					onClick: () => actions.open(),
					children: "结构化输入任务"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"data-structured-prompt-library-trigger": "",
					style: look(libraryActive),
					title: "提示词库：检索公开提示词库，预览后可直接发送",
					"aria-haspopup": "dialog",
					"aria-expanded": libraryActive,
					disabled,
					onMouseDown: (event) => {
						event.preventDefault();
					},
					onClick: () => actions.openLibrary(),
					children: "提示词库"
				})]
			});
		}
		//#endregion
		//#region src/client/send.ts
		/**
		* 把成稿发送进指定会话。
		*
		* 服务缺失（会话已销毁、`conversation` 未装配）或投递失败都只记录日志，不向上抛
		* —— 发送是弹窗的收尾动作，不该因为一次投递失败把界面拖垮。
		* @param ctx - 插件上下文。
		* @param sessionId - 目标会话。
		* @param prompt - 构建好的提示词。
		*/
		function sendPrompt(ctx, sessionId, prompt) {
			try {
				const conversation = (ctx.get("sessions")?.scope?.(sessionId))?.get?.("conversation");
				if (conversation === void 0 || typeof conversation.send !== "function") {
					console.error("[structured-prompt] 无法发送：当前作用域取不到 conversation 服务", { sessionId });
					return;
				}
				conversation.send(prompt).catch((error) => {
					console.error("[structured-prompt] 发送提示词失败：", error);
				});
			} catch (error) {
				console.error("[structured-prompt] 发送提示词时异常：", error);
			}
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* 结构化输入任务插件 —— DSH 浏览器半边。
		*
		* 两个槽位注册，共用同一个 `store` 句柄：
		*  - `conversation.input.left`（list）—— 输入框底部工具栏里的入口按钮。
		*  - `conversation.input.dock`（list）—— 打开时渲染表单弹窗，关闭时不占空间。
		*
		* 两个注册**都必须声明 `store` 座位**：`useStore`/`actions` 不是标准 props，而是
		* 渲染器在 `host.storeOf(entry)` 有值时才注入的。漏声明会让组件拿到 `undefined`、
		* 渲染时抛错，条目随即被隔离失效（表现为"按钮消失"）。
		*
		* 本插件不读 `remote.<namespace>`，也不读插件与 skills 清单：手动工具策略由用户直接填写
		* 工具名，不再从"已安装清单"里勾选 —— DSH 的插件清单列的是自带插件而非用户安装的插件，
		* skills 清单也不属于本插件的职责；工具检索在输入框的 `/` 菜单里。因此 `inject` 只有
		* `slots`，也没有任何 RPC；唯一触到主机的动作是发送链路（会话作用域上的
		* `conversation.send`，见 `send.ts`）。
		*
		* 表单弹窗挂在 `input.dock`，而不是接管输入框的两个候选：
		*  - `conversation.composer`（chain）：`select` 是纯函数，只在槽位重渲染时重新
		*    执行；store 更新不会触发槽位重渲染（只有 session 源/props 变化才会），所以
		*    链入口无法在用户点击后自行接管。
		*  - `conversation.composer.bar`（single）：遮蔽是静态的，同一 cell 只有最低
		*    优先级者渲染，无法"仅在打开时"接管。
		*/
		/**
		* 插件依赖：只需要槽位注册。
		*
		* 这里刻意不声明 `remote.*`：命名空间是各自注册的 Cordis 服务（键为
		* `remote.<namespace>`），硬声明会在缺少该命名空间的组装里让插件停在 PENDING。
		* 本插件目前不读主机数据，因此没有这类依赖。
		*/
		const inject = ["slots"];
		/**
		* 本插件的槽位注册表。
		*
		* 两个注册共享同一个 store 句柄，渲染器按「handle × sessionId」共享实例，因此
		* 入口的 `open()` 会直接驱动弹窗组件重渲染。
		*
		* `input.dock` 的注册额外声明 `inject`：把宿主的发送能力包成 `onSend(prompt)` 交给
		* 弹窗组件 —— 组件因此不必接触 `ctx`，也不必假定输入框此刻是否挂载。
		* @param store - `createStructuredInputStore()` 的句柄。
		* @param sendPrompt - 把成稿发送进指定会话的宿主回调。
		* @returns 注册列表。
		*/
		function slotEntries(store, sendPrompt) {
			return [{
				name: "conversation.input.left",
				options: {
					name: "conversation.input.left",
					id: "structured-prompt",
					order: 20,
					store
				},
				component: StructuredInputTrigger
			}, {
				name: "conversation.input.dock",
				options: {
					name: "conversation.input.dock",
					id: "structured-prompt",
					order: 10,
					store,
					inject: (sessionId) => ({ 
					/**
					* 把成稿发送进当前会话。
					* @param prompt - 构建好的提示词。
					*/
onSend: (prompt) => {
						sendPrompt(sessionId, prompt);
					} })
				},
				component: StructuredInputPanel
			}];
		}
		/** 注入的样式标签选择器，避免重复加载时叠加。 */
		const STYLE_SELECTOR = "style[data-plugin-css=\"dsh-plugin-structured-prompt\"]";
		/**
		* 注入一次插件样式（内联样式覆盖不到的伪类与滚动条）。
		* @param ctx - 插件上下文。
		*/
		function installStyles(ctx) {
			ctx.effect(() => {
				if (document.querySelector(STYLE_SELECTOR) === null) {
					const tag = document.createElement("style");
					tag.dataset["plugin"] = "dsh-plugin-structured-prompt";
					tag.dataset["pluginCss"] = "dsh-plugin-structured-prompt";
					tag.textContent = PANEL_CSS;
					document.head.appendChild(tag);
				}
				return () => {
					document.querySelector(STYLE_SELECTOR)?.remove();
				};
			}, "structured-prompt: styles");
		}
		/**
		* 客户端插件主体。
		* @param ctx - Web Client 根上下文。
		*/
		function apply(ctx) {
			const store = createStructuredInputStore();
			installStyles(ctx);
			const entries = slotEntries(store, (sessionId, prompt) => {
				sendPrompt(ctx, sessionId, prompt);
			});
			for (const entry of entries) ctx.slots.inject(entry.name, () => ctx.slots.register(entry.options, entry.component));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.slotEntries = slotEntries;
		return module.exports;
	}
});
