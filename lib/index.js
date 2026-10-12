//#region src/shared/forms.ts
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
//#endregion
//#region src/shared/prompt.ts
/** 把文本按行清洗：去掉行尾空白、折叠连续空行、去首尾空行。 */
function normalizeBlock(text) {
	return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
/** 逐条清洗数组：丢弃空白条目并去掉首尾空白。 */
function cleanList(items) {
	return items.map((item) => item.trim()).filter((item) => item !== "");
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
* 构建结构化系统提示词。
* @param form - 表单字段。
* @returns 组装后的提示词；身份与目标均为空时返回空串。
*/
function buildSystemPrompt(form) {
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
	const outputBody = [
		form.outputFormat === "" ? "" : OUTPUT_FORMAT_SKELETONS[form.outputFormat],
		fields.length === 0 ? "" : ["字段说明：", ...fields.map((item) => `- ${item}`)].join("\n"),
		languageTone === "" ? "" : `表达要求：${languageTone}`,
		normalizeBlock(form.outputSpec)
	].filter((text) => text !== "").join("\n");
	const fallback = normalizeBlock(form.fallback);
	const examples = normalizeBlock(form.examples);
	return [
		identity === "" ? "" : `# 身份\n${identity}`,
		goal === "" ? "" : `# 目标\n${goal}`,
		rulesBody === "" ? "" : `# 硬性规则（必须遵守，优先于其他任何要求）\n${rulesBody}`,
		guidanceBody === "" ? "" : `# 工具使用策略\n${guidanceBody}`,
		outputBody === "" ? "" : `# 输出格式\n${outputBody}`,
		fallback === "" ? "" : `# 数据不足时\n${fallback}`,
		examples === "" ? "" : `# 示例\n${examples}`
	].filter((section) => section !== "").join("\n\n");
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
//#region src/shared/templates.ts
/** 原始使用示例：一键填充用的「告警研判」模板。 */
const ALERT_TRIAGE_FIELDS = {
	role: "你是一名负责线上稳定性的 SRE 助手，服务于一个日订单量百万级的电商系统。",
	goal: "根据监控数据判断告警是否需要人工立即介入，并给出首要排查方向。",
	rules: [
		"只能基于工具返回的数据下结论，不得引用记忆中其他系统的经验值。",
		"所有数值必须带上单位和时间窗口，例如 940ms / 近 5 分钟。",
		"阈值判断必须以指标配置为准；配置缺失时明确说明缺失，不要用默认值代替。"
	],
	forbidden: ["不得输出任何猜测性的根因结论（例如“疑似数据库慢查询”）。"],
	toolPolicy: "auto",
	toolGuidance: ["先调用 query_metrics 拿指标，再调用 get_threshold_config 拿阈值，顺序不可颠倒。", "如果指标数据的时间窗口与阈值配置不一致，先调用 list_metric_windows 确认可用窗口。"],
	toolFailure: "任何一次工具调用失败，最多重试一次；仍失败则直接报告失败，不要用估计值代替。",
	outputFormat: "json",
	fields: [
		"severity: \"P0\" | \"P1\" | \"P2\" | \"info\"",
		"metric: { name, value, unit, window }",
		"threshold: { value, unit, source } 或 null",
		"breached: boolean",
		"first_checks: string[]  // 1-3 条首要排查方向",
		"data_gaps: string[]     // 缺失的数据项，没有则空数组"
	],
	fallback: "若关键指标或阈值任一缺失，severity 返回 \"info\"，并在 data_gaps 中列出缺失项。禁止编造数值。"
};
/** 代码审查模板。 */
const CODE_REVIEW_FIELDS = {
	role: "你是一名严格的高级工程师，负责对提交的改动做缺陷导向的代码审查。",
	goal: "找出改动中会导致线上故障、数据错误或安全问题的缺陷，并按严重度排序。",
	successCriteria: "每条结论都能指向具体文件与代码位置；没有发现缺陷时明确说明。",
	rules: ["只审查本次改动涉及的范围，不扩展评审范围。", "每条问题必须给出文件路径与行号。"],
	forbidden: ["不得提出纯粹的风格偏好（命名、空行、注释密度）。"],
	toolPolicy: "auto",
	toolGuidance: ["先读取改动范围内的文件，再下结论。"],
	toolFailure: "读取失败时明确说明哪些文件未能读取，不要凭猜测补充内容。",
	outputFormat: "json",
	languageTone: "简洁直接，中文，不写客套话。",
	fields: [
		"severity: \"blocker\" | \"major\" | \"minor\"",
		"file: string",
		"line: number",
		"problem: string",
		"suggestion: string"
	],
	fallback: "若无法获取完整改动内容，返回空数组并在 summary 中说明原因。"
};
/** 数据提取模板。 */
const DATA_EXTRACT_FIELDS = {
	role: "你是一名数据抽取助手，把非结构化文本转换为结构化记录。",
	goal: "从输入文本中抽取指定字段，输出可直接入库的记录。",
	successCriteria: "每条记录字段齐全且与原文一致。",
	rules: ["字段值必须逐字来自原文，不得改写或补全。"],
	forbidden: ["不得编造原文中不存在的字段值。"],
	toolPolicy: "auto",
	outputFormat: "json",
	fields: ["records: object[]  // 每条记录一条"],
	fallback: "字段在原文中缺失时填 null，并在 missing 数组中列出字段名。禁止编造。"
};
/** 报告撰写模板。 */
const REPORT_FIELDS = {
	role: "你是一名技术分析师，把已有材料整理成可决策的报告。",
	goal: "基于给定材料输出一份结论先行、依据可追溯的简报。",
	successCriteria: "读者能在第一段拿到结论与建议。",
	rules: ["结论必须由给出的材料支撑，不引入材料之外的事实。"],
	forbidden: ["不得虚构数据、时间或引用来源。"],
	toolPolicy: "auto",
	outputFormat: "markdown",
	languageTone: "中文，面向管理者，控制在一页内。",
	fallback: "材料不足以支撑某项结论时，在「待确认」一节列出，不要给出推测值。"
};
/**
* 内置模板库。
*
* `build()` 把字段片段补全成完整表单（缺省项为空），交给 store 的 `setForm`。
*/
const TEMPLATES = [
	{
		id: "alert-triage",
		label: "告警研判（原始示例）",
		build: () => completeForm(ALERT_TRIAGE_FIELDS)
	},
	{
		id: "code-review",
		label: "代码审查",
		build: () => completeForm(CODE_REVIEW_FIELDS)
	},
	{
		id: "data-extract",
		label: "数据提取",
		build: () => completeForm(DATA_EXTRACT_FIELDS)
	},
	{
		id: "report",
		label: "报告撰写",
		build: () => completeForm(REPORT_FIELDS)
	}
];
//#endregion
//#region src/host/args.ts
/**
* 工具参数的处理：收窄、默认值回退、以及工具名/用途的配对拆分。
*
* 从 `tool.ts` 拆出，让那个文件只留「定义 + 构建」。
*
* 这里承担了 registry 之外的类型检查：本插件刻意不 import 宿主包（理由见
* `parameters.ts`），因此不能借 `defineTool` 做参数校验，逐字段检查由 `narrowArgs`
* 代劳。不合规就**报错**而不是静默丢弃 —— 失败说明会回到模型手里，它能据此改正。
*/
/** 需要按「字符串数组」读取的字段名。 */
const ARRAY_FIELDS = [
	"rules",
	"forbidden",
	"callable_tools",
	"tool_guidance",
	"fields"
];
/** 需要按「字符串」读取的非必填字段名。 */
const STRING_FIELDS = [
	"template",
	"background",
	"success_criteria",
	"tool_policy",
	"tool_failure",
	"output_format",
	"output_spec",
	"language_tone",
	"fallback",
	"examples"
];
/**
* 把模型传入的参数收窄成可用形状。
* @param raw - 模型传入的参数。
* @returns 收窄后的参数。
* @throws {Error} 缺少必填项或字段类型不符时。
*/
function narrowArgs(raw) {
	if (typeof raw !== "object" || raw === null) throw new Error("arguments must be an object");
	const args = raw;
	const problems = [];
	for (const field of ["role", "goal"]) {
		const value = args[field];
		if (typeof value !== "string" || value.trim() === "") problems.push(`${field} is required and must be a non-empty string`);
	}
	for (const field of STRING_FIELDS) {
		const value = args[field];
		if (value !== void 0 && typeof value !== "string") problems.push(`${field} must be a string`);
	}
	for (const field of ARRAY_FIELDS) {
		const value = args[field];
		if (value === void 0) continue;
		if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) problems.push(`${field} must be an array of strings`);
	}
	if (problems.length > 0) throw new Error(`invalid arguments: ${problems.join("; ")}`);
	const narrowed = {
		role: args.role.trim(),
		goal: args.goal.trim()
	};
	for (const field of STRING_FIELDS) {
		const value = args[field];
		if (typeof value === "string") narrowed[field] = value;
	}
	for (const field of ARRAY_FIELDS) {
		const value = args[field];
		if (Array.isArray(value)) narrowed[field] = value;
	}
	return narrowed;
}
/**
* 取「调用参数优先，未给则用模板默认值」的值。
*
* 空串与空数组都算「未给」：模板填了 3 条硬性规则时，模型传 `rules: []` 的意图几乎
* 总是"没额外要求"，而不是"把模板的规则删掉"。
* @param provided - 模型传入的值。
* @param fallback - 模板/空白表单的默认值。
* @returns 生效的值。
*/
function prefer(provided, fallback) {
	if (provided === void 0) return fallback;
	if (typeof provided === "string" && provided.trim() === "") return fallback;
	if (Array.isArray(provided) && provided.length === 0) return fallback;
	return provided;
}
/**
* 把「工具名」或「工具名：用途」形式的条目拆成两个按索引配对的数组。
*
* 表单侧是工具名与用途两个数组配对编辑；工具参数为了简洁只收一个字符串数组，
* 因此在这里按全角/半角冒号拆一次。
* @param entries - 模型传入的条目。
* @returns 工具名数组与用途数组（长度对齐）。
*/
function splitCallableTools(entries) {
	const tools = [];
	const slots = [];
	for (const entry of entries) {
		const matched = /^([^：:]+)[：:](.*)$/.exec(entry);
		if (matched === null) {
			tools.push(entry.trim());
			slots.push("");
		} else {
			tools.push((matched[1] ?? "").trim());
			slots.push((matched[2] ?? "").trim());
		}
	}
	return {
		tools,
		slots
	};
}
/**
* 解析输出格式说明，语义与客户端 `OutputSection.pickFormat` 一致：选了格式就补上该
* 格式骨架，但**只在本字段为空、或正文仍恰好是另一套骨架**时覆盖 —— 手写过的内容
* 不会被冲掉。两个入口行为一致，才不会出现"表单里选 json 有骨架、工具里选 json 没
* 骨架"的偏差。
* @param providedSpec - 模型传入的格式说明。
* @param format - 生效的输出格式。
* @param baseSpec - 模板/空白表单的格式说明。
* @returns 生效的格式说明。
*/
function resolveOutputSpec(providedSpec, format, baseSpec) {
	const provided = providedSpec !== void 0 && providedSpec.trim() !== "";
	const current = provided ? providedSpec : baseSpec;
	if (provided || format === "") return current;
	const known = Object.values(OUTPUT_FORMAT_SKELETONS);
	if (current.trim() !== "" && !known.includes(current)) return current;
	return OUTPUT_FORMAT_SKELETONS[format];
}
//#endregion
//#region src/host/parameters.ts
/**
* 工具的参数与输出 schema（纯数据，无逻辑）。
*
* 这里写的是**标准 JSON Schema**，而不是 DSH `defineTool` 的作者向 spec —— 因为本插件
* 刻意**不 import 任何宿主包**：
*
* 宿主包（`@deepseek-ai/dsh-tools`）只能从 profile 的 node_modules 解析，而 `link:`
* 安装下插件经 junction 加载，ESM 会 realpath 到源码目录，向上找不到任何 node_modules
* → 模块加载失败 → 插件 fiber 停在未激活状态（表现为工具不注册，且不报错）。
* client 半边本来就用本地类型声明避开同类问题，host 半边照做。
*
* 与 `tool.ts` 分开是为了让那个文件只承载「参数 → 表单 → 提示词」的映射逻辑。
*/
/**
* 可选的输出格式：取自构建器的骨架表，避免两份清单各自漂移。
* @see OUTPUT_FORMAT_SKELETONS
*/
const OUTPUT_FORMATS = Object.keys(OUTPUT_FORMAT_SKELETONS);
/** 可选的内置模板 id。 */
const TEMPLATE_IDS = TEMPLATES.map((template) => template.id);
/** 模型面向的工具说明。 */
const TOOL_DESCRIPTION = [
	"Build a precise, structured prompt and return it verbatim.",
	"Use it to turn a vague delegation into an explicit one: fill `role` and `goal` (plus",
	"whichever optional fields matter) and pass the returned text as the `prompt` argument",
	"of the subagent tool. Those two are required, matching the form; every other field is",
	"optional — add `rules`, `forbidden`, `output_format`, `fallback` and so on when the",
	"child needs tighter constraints. `template` starts from a built-in template — its",
	"fields act as defaults and anything you pass overrides them."
].join(" ");
/**
* 参数表（标准 JSON Schema）。
*
* 分节顺序与客户端表单一致（身份/目标 → 规则 → 工具 → 输出/兜底），便于两边对照。
* `additionalProperties: false` 让越界字段在 schema 边界被拒绝，而不是被静默忽略。
*/
const TOOL_PARAMETERS_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		role: {
			type: "string",
			description: "The identity the target agent should adopt (e.g. \"a strict senior engineer\"). Required, like the form."
		},
		goal: {
			type: "string",
			description: "The task the target agent must accomplish. One or two imperative sentences."
		},
		template: {
			type: "string",
			enum: TEMPLATE_IDS,
			description: "Start from a built-in template; its fields become defaults for anything you omit."
		},
		background: {
			type: "string",
			description: "Context the target agent needs but cannot infer (paths, stack, prior decisions)."
		},
		success_criteria: {
			type: "string",
			description: "How the result will be judged — the evidence that makes the task done."
		},
		rules: {
			type: "array",
			items: { type: "string" },
			description: "Hard constraints, emitted as a numbered list. Order is preserved."
		},
		forbidden: {
			type: "array",
			items: { type: "string" },
			description: "Explicitly disallowed actions, emitted as a sub-block under the hard rules."
		},
		tool_policy: {
			type: "string",
			enum: ["auto", "manual"],
			description: "auto: let the target agent choose tools. manual: it may use only `callable_tools`."
		},
		callable_tools: {
			type: "array",
			items: { type: "string" },
			description: "With tool_policy=manual, the allowed tools. Each entry is `tool_name` or `tool_name: purpose`."
		},
		tool_guidance: {
			type: "array",
			items: { type: "string" },
			description: "Per-line rules about when and how to use tools."
		},
		tool_failure: {
			type: "string",
			description: "What to do when a tool call fails (retry, fall back, report)."
		},
		output_format: {
			type: "string",
			enum: OUTPUT_FORMATS,
			description: "Output shape; also seeds `output_spec` with a skeleton when you omit it."
		},
		output_spec: {
			type: "string",
			description: "Exact output contract — sections, keys, ordering. Overrides the format skeleton."
		},
		language_tone: {
			type: "string",
			description: "Language and tone for the final answer."
		},
		fields: {
			type: "array",
			items: { type: "string" },
			description: "Per-field requirements for structured output (one line each)."
		},
		fallback: {
			type: "string",
			description: "What to do when the task cannot be completed as specified (e.g. insufficient data)."
		},
		examples: {
			type: "string",
			description: "A short input/output example when the expected shape is easier to show than to describe."
		}
	},
	required: ["role", "goal"]
};
/** canonical 输出值的 schema。 */
const TOOL_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		prompt: {
			type: "string",
			description: "The built prompt, ready to use as-is."
		},
		template: {
			type: "string",
			description: "Template id used as the base; empty when none."
		},
		missing: {
			type: "array",
			items: { type: "string" },
			description: "Required fields still empty after completion (normally empty)."
		}
	},
	required: [
		"prompt",
		"template",
		"missing"
	]
};
//#endregion
//#region src/host/tool.ts
/**
* 模型可调用的结构化提示词构建工具。
*
* 与客户端表单**共用** `src/shared/prompt.ts` 的构建逻辑，因此两个入口产出的提示词
* 完全一致（段落顺序、省略规则、编号格式都是同一份实现）。参数与输出 schema 见
* `parameters.ts`，参数收窄与映射工具见 `args.ts`。
*
* 工具只**产出**提示词，不启动子代理：模型拿到文本后自行决定用途 —— 作为 `subagent`
* 的 `prompt` 参数、写进文件、或用在自己身上。这样本插件对子代理机制零耦合，也不
* 需要关心 provider、前后台、深度限制等策略。
*
* **不 import 任何宿主包**：工具定义按 DSH 的 `ToolDefinition` 契约手工构造（理由见
* `parameters.ts`）。这是本插件在 `link:` 安装下能正常激活的前提 —— 宿主包只能从
* profile 的 node_modules 解析，而 link 经 junction 加载后 ESM 会 realpath 到源码目录，
* 那里没有任何 node_modules。
*/
/** 模型可见的工具名。 */
const STRUCTURED_PROMPT_TOOL = "build_structured_prompt";
/**
* 纯构建：参数 → 表单 → 提示词。
*
* 与 `execute` 分开，让测试可以绕过参数校验直接验证映射规则。
* @param raw - 已收窄的参数。
* @returns canonical 值。
*/
function buildFromArgs(raw) {
	const asString = (field) => {
		const value = raw[field];
		return typeof value === "string" ? value : void 0;
	};
	const asArray = (field) => {
		const value = raw[field];
		return Array.isArray(value) ? value : void 0;
	};
	const templateId = asString("template");
	const chosen = templateId === void 0 ? void 0 : TEMPLATES.find((template) => template.id === templateId);
	const base = chosen === void 0 ? completeForm({}) : chosen.build();
	const callable = splitCallableTools(asArray("callable_tools") ?? []);
	const format = prefer(asString("output_format"), base.outputFormat);
	const form = {
		role: prefer(asString("role"), base.role),
		goal: prefer(asString("goal"), base.goal),
		background: prefer(asString("background"), base.background),
		successCriteria: prefer(asString("success_criteria"), base.successCriteria),
		rules: prefer(asArray("rules"), base.rules),
		forbidden: prefer(asArray("forbidden"), base.forbidden),
		toolPolicy: prefer(asString("tool_policy"), base.toolPolicy),
		callableTools: callable.tools.length > 0 ? callable.tools : base.callableTools,
		toolSlots: callable.tools.length > 0 ? callable.slots : base.toolSlots,
		toolGuidance: prefer(asArray("tool_guidance"), base.toolGuidance),
		toolFailure: prefer(asString("tool_failure"), base.toolFailure),
		outputSpec: resolveOutputSpec(asString("output_spec"), format, base.outputSpec),
		outputFormat: format,
		languageTone: prefer(asString("language_tone"), base.languageTone),
		fields: prefer(asArray("fields"), base.fields),
		fallback: prefer(asString("fallback"), base.fallback),
		examples: prefer(asString("examples"), base.examples)
	};
	return {
		prompt: buildSystemPrompt(form),
		template: chosen?.id ?? "",
		missing: validateForm(form)
	};
}
/**
* 构造工具定义。
*
* 单独导出（而不是在模块顶层直接构造）是为了让测试能拿到定义直接调用 `execute` /
* `render`，无需启动一个 Cordis 上下文。
* @returns registry-ready 的工具定义。
*/
function createStructuredPromptTool() {
	return {
		name: STRUCTURED_PROMPT_TOOL,
		description: TOOL_DESCRIPTION,
		parameters: TOOL_PARAMETERS_SCHEMA,
		output: {
			schema: TOOL_OUTPUT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: value.missing.length === 0 ? value.prompt : `${value.prompt}\n\n---\n(Required field(s) still empty: ${value.missing.join(", ")}.)`
			}]
		},
		execute(args) {
			return Promise.resolve(buildFromArgs(narrowArgs(args)));
		}
	};
}
/**
* 注册结构化提示词工具。
* @param ctx - host 侧插件上下文。
* @returns 服务的返回值（取消注册函数）。
*/
function registerStructuredPromptTool(ctx) {
	return ctx.tools.register(createStructuredPromptTool());
}
//#endregion
//#region src/index.ts
/**
* host 侧依赖：只需要工具注册面。
*
* 声明为硬依赖（而不是 `ctx.get` 可选读取）是有意的 —— 没有 `tools` 服务时本半边
* 无事可做，静默变成空插件反而更难排查。
*/
const inject = ["tools"];
/**
* 插件 host 主体。
* @param ctx - host 上下文。
*/
function apply(ctx) {
	registerStructuredPromptTool(ctx);
}
//#endregion
export { apply, inject };
