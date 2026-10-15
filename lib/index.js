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
//#endregion
//#region src/shared/forms.ts
/**
* 表单的构造与序列化工具。
*
* 独立成模块是为了让 `store.ts`（状态）与 `templates.ts`（模板）共用同一份空白
* 字段定义，而两者之间不必互相引用。
*
* 序列化一侧（`serializeForm` / `parseFormDocument`）承担两件事：给导出文档打上
* schema 版本号，以及把导入的任意 JSON **过滤 + 校验**成已知字段 —— 直接铺进表单
* 会让未知键混进 `PromptForm`。
*/
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
//#region src/host/args.ts
/**
* 工具参数的处理：收窄、默认值回退、以及工具名/用途的配对拆分。
*
* 从 `tool.ts` 拆出，让那个文件只留「定义 / 执行 / 卡片」（表单映射在 `build.ts`）。
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
* 需要按枚举校验的字段。
*
* 越界值不会报错，只会让下游**静默降级**（例如骨架查不到，输出格式段少一段），因此
* 在参数边界就拒绝：这个来源是模型，而模型能读懂错误信息并改正。
*/
const ENUM_FIELDS = {
	output_format: Object.keys(OUTPUT_FORMAT_SKELETONS),
	tool_policy: ["auto", "manual"],
	template: TEMPLATES.map((template) => template.id)
};
/**
* 把模型传入的参数收窄成可用形状。
* @param raw - 模型传入的参数。
* @returns 收窄后的参数。
* @throws {Error} 字段类型不符、枚举越界，或"未指模板且缺 role/goal"时。
*/
function narrowArgs(raw) {
	if (typeof raw !== "object" || raw === null) throw new Error("arguments must be an object");
	const args = raw;
	const problems = [];
	const usesTemplate = typeof args["template"] === "string" && args["template"].trim() !== "";
	for (const field of ["role", "goal"]) {
		const value = args[field];
		if (value !== void 0 && typeof value !== "string") {
			problems.push(`${field} must be a string`);
			continue;
		}
		if (typeof value === "string" && value.trim() !== "") continue;
		if (usesTemplate) continue;
		problems.push(`${field} is required and must be a non-empty string (or pass \`template\`: every built-in template carries a role and a goal)`);
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
	for (const [field, allowed] of Object.entries(ENUM_FIELDS)) {
		const value = args[field];
		if (value === void 0) continue;
		if (typeof value === "string" && value.trim() === "") continue;
		if (typeof value !== "string" || !allowed.includes(value)) problems.push(`${field} must be one of: ${allowed.join(", ")}`);
	}
	const rawDelegate = args["delegate"];
	let delegate;
	if (rawDelegate !== void 0) if (typeof rawDelegate !== "object" || rawDelegate === null || Array.isArray(rawDelegate)) problems.push("delegate must be an object");
	else {
		const record = rawDelegate;
		for (const [key, value] of Object.entries(record)) if (key !== "label" && key !== "provider") problems.push(`delegate.${key} is not a supported field`);
		else if (typeof value !== "string") problems.push(`delegate.${key} must be a string`);
		const label = record["label"];
		const provider = record["provider"];
		delegate = {
			...typeof label === "string" ? { label } : {},
			...typeof provider === "string" ? { provider } : {}
		};
	}
	if (problems.length > 0) throw new Error(`invalid arguments: ${problems.join("; ")}`);
	const narrowed = {};
	for (const field of ["role", "goal"]) {
		const value = args[field];
		if (typeof value === "string" && value.trim() !== "") narrowed[field] = value.trim();
	}
	if (delegate !== void 0) narrowed["delegate"] = delegate;
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
* 空串（含纯空白）、空数组、以及**全由空白条目组成的数组**都算「未给」：模板填了 3 条
* 硬性规则时，模型传 `rules: []` 或 `rules: ['']` 的意图几乎总是"没额外要求"，而不是
* "把模板的规则删掉"。整组判定而不是逐条过滤 —— 逐条过滤会丢掉空串、让工具名与用途的
* 索引错位（那些空工具名行的忽略发生在下游，按原始索引处理）。
* @param provided - 模型传入的值。
* @param fallback - 模板/空白表单的默认值。
* @returns 生效的值。
*/
function prefer(provided, fallback) {
	if (provided === void 0) return fallback;
	if (isBlankItem(provided)) return fallback;
	if (Array.isArray(provided) && provided.every(isBlankItem)) return fallback;
	return provided;
}
/**
* 数组条目算不算「空白」。
*
* 非字符串条目按非空白处理：`prefer` 只负责判断"给没给"，条目怎么处理是下游的事。
* @param item - 数组条目。
* @returns 字符串且 trim 后为空时为 `true`。
*/
function isBlankItem(item) {
	return typeof item === "string" && item.trim() === "";
}
/**
* 一批调用参数条目算不算「给了」。
*
* 与 `prefer` 共用 {@link isBlankItem}：空数组与全空白条目都算「未给」。导出它是为了让
* 必须**整组同进同退**的字段（工具名与用途）复用同一条规则 —— 各自判定会让两个数组
* 错位，例如 `[': 用途']` 的工具名为空而用途非空。
* @param items - 调用参数里的字符串数组。
* @returns 至少有一个非空白条目时为 `true`。
*/
function isProvidedList(items) {
	return items !== void 0 && !items.every(isBlankItem);
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
		const matched = /^([^：:]*)[：:](.*)$/.exec(entry);
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
* 构建结构化系统提示词。
* @param form - 表单字段。
* @returns 组装后的提示词；身份与目标均为空时返回空串。
*/
function buildSystemPrompt(form) {
	return renderPrompt(buildSystemPromptSections(form));
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
//#region src/host/build.ts
/**
* 纯构建：已收窄的参数 → 表单 → 提示词。
*
* 从 `tool.ts` 拆出，让那里只保留"工具定义"（schema、行为、卡片）；这里可以单独被测试
* 绕过参数校验地调用。
*
* 与客户端表单共用 `src/shared/prompt.ts`，因此两个入口的产出必然一致。
*/
/**
* 纯构建：参数 → 表单 → 提示词。
*
* 空串（含纯空白）、空数组与全空白条目都算「未给」（见 `prefer` 与 `isProvidedList`）；
* `template` 提供默认值、调用参数逐字段覆盖。
* @param raw - 已收窄的参数。
* @returns 构建结果。
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
	const chosen = findTemplate(asString("template") ?? "");
	const base = chosen === void 0 ? completeForm({}) : chosen.build();
	const rawTools = asArray("callable_tools");
	const picked = resolveCallableTools(rawTools, splitCallableTools(rawTools ?? []), base);
	const format = prefer(asString("output_format"), base.outputFormat);
	const providedSpec = asString("output_spec");
	const form = {
		role: prefer(asString("role"), base.role),
		goal: prefer(asString("goal"), base.goal),
		background: prefer(asString("background"), base.background),
		successCriteria: prefer(asString("success_criteria"), base.successCriteria),
		rules: prefer(asArray("rules"), base.rules),
		forbidden: prefer(asArray("forbidden"), base.forbidden),
		toolPolicy: prefer(asString("tool_policy"), base.toolPolicy),
		callableTools: picked.callableTools,
		toolSlots: picked.toolSlots,
		toolGuidance: prefer(asArray("tool_guidance"), base.toolGuidance),
		toolFailure: prefer(asString("tool_failure"), base.toolFailure),
		outputSpec: prefer(providedSpec, applyFormatChoice(base.outputSpec, format)),
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
* 选出最终生效的工具名与用途。
*
* 两个字段**整组同进同退**：要么都取调用参数，要么都回退底座。判定按**原始条目**做，
* 而不是按拆分后的工具名 —— `[': 用途']` 算"给了"（用途非空），那一行随后由下游按空
* 工具名整行忽略；若改成拿拆分后的两个数组各自判定，工具名会回退底座而用途不回退，
* 用途就配到了别的工具上。
*
* 抽成纯函数是为了让这条不变量能被直接断言：内置模板都不带清单，底座为空时"一退一留"
* 在产物上不可观测，只能测这个函数本身。
* @param rawTools - `callable_tools` 的原始取值（未拆分）；`undefined` 表示未给。
* @param callable - 拆分后的工具名与用途。
* @param base - 底座表单（模板或空白）。
* @returns 生效的工具名与用途；两者来源与长度都一致。
*/
function resolveCallableTools(rawTools, callable, base) {
	return isProvidedList(rawTools) ? {
		callableTools: [...callable.tools],
		toolSlots: [...callable.slots]
	} : {
		callableTools: [...base.callableTools],
		toolSlots: [...base.toolSlots]
	};
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
* → 模块加载失败 → 插件 fiber 停在未激活状态（表现为工具不注册；当时的现场里连错误都不
* 显眼，当前的 profile 启动有最终审计会把未激活的条目连名字一起抛出来）。
* client 半边本来就用本地类型声明避开同类问题，host 半边照做。
*
* 与 `tool.ts` 分开，是为了让 schema 这类纯数据与「定义 / 执行 / 卡片」的代码各归一处
* （参数 → 表单 → 提示词的映射在 `build.ts`）。
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
	"Use it to turn a vague delegation into an explicit one: fill `role` and `goal`, or start",
	"from a `template` (every built-in one carries both), then pass the returned text as the",
	"`prompt` argument of the subagent tool. Every other field is optional — add `rules`,",
	"`forbidden`, `output_format`, `fallback` and so on when the child needs tighter",
	"constraints. A template's fields act as defaults and anything you pass overrides them;",
	"state the concrete task even when the template already has a goal, since that goal is",
	"generic. For example: `{ template: 'code-review', goal: '<the concrete task>' }`.",
	"Skip it for simple delegations — calling the subagent tool directly with a plain task is",
	"cheaper. This tool earns its cost when the child needs several explicit constraints you",
	"would otherwise have to spell out anyway."
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
			description: "The identity the target agent should adopt (e.g. \"a strict senior engineer\"). Required, like the form — unless `template` carries it, in which case you may omit it."
		},
		goal: {
			type: "string",
			description: "The task the target agent must accomplish. One or two imperative sentences. Required unless `template` carries it — but state the concrete task whenever you can: a template only carries a generic one."
		},
		template: {
			type: "string",
			enum: TEMPLATE_IDS,
			description: "Start from a built-in template: its fields — including `role` and `goal` — become defaults for anything you omit, so you only fill what is task-specific. Pick by task shape — " + TEMPLATES.map((item) => `${item.id}: ${item.whenToUse}`).join("; ") + "."
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
		},
		delegate: {
			type: "object",
			additionalProperties: false,
			properties: {
				label: {
					type: "string",
					description: "Short label for the delegation, shown in the child list."
				},
				provider: {
					type: "string",
					description: "Subagent provider name. Normally omit it: the deployment default is used (a one-shot run unless the profile configured otherwise). Pass it only to deliberately delegate through another registered provider — e.g. one that inherits this conversation instead of working independently."
				}
			},
			description: "Optional — run the built prompt as a foreground subagent instead of returning it. Useful when this conversation is already long, or when the work needs broad exploration: the prompt then never enters your own context. Avoid it on the first turn, while the task is still being pinned down and there is no history to work from: the child runs standalone and cannot see this conversation, so everything it needs must be written into the prompt."
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
		},
		delegated: {
			type: "string",
			description: "The subagent's output when `delegate` was set; empty otherwise."
		},
		delegation: {
			type: "string",
			description: "Non-empty when the prompt was actually delegated, e.g. \"spawn/child-1 (completed)\". Distinguishes a silent subagent (completed but produced no text) from no delegation at all."
		}
	},
	required: [
		"prompt",
		"template",
		"missing",
		"delegated",
		"delegation"
	]
};
//#endregion
//#region src/host/subagents.ts
/**
* 首选 provider 名。
*
* 一次性的独立子代理，与"把任务交出去执行"的语义一致。DSH 的 base bundle 注册的
* `spawn` 正是它；另一个候选 `fork` 会继承父会话上下文，用途不同。
*/
const PREFERRED_PROVIDER = "spawn";
/**
* 选出要用的 provider。
*
* 本函数只看 `requested`：调用方已经把「调用参数 > 装载行 config」算好再传进来（见
* `tool.ts` 的 `prefer(delegate.provider, config?.provider)`）。`requested` 非空时才被当作
* "点名"，那时它必须已注册；为空时只有一个 provider 就直接用它，多个时取
* {@link PREFERRED_PROVIDER}（存在时）、否则取第一个 —— 一个都没有说明该组装没装配子代理能力。
* @param subagents - 子代理服务。
* @param requested - 调用方指定的 provider 名（可选；空串按未指定处理）。
* @returns 生效的 provider 名。
* @throws {Error} 未注册任何 provider、或点名了一个不存在的名字时。
*/
function resolveProviderName(subagents, requested) {
	const names = subagents.list().map((name) => name.trim()).filter((name) => name !== "");
	const wanted = (requested ?? "").trim();
	if (wanted !== "") {
		if (!names.includes(wanted)) throw new Error(`unknown subagent provider "${wanted}"; available: ${names.join(", ") || "(none)"}`);
		return wanted;
	}
	const [first] = names;
	if (first === void 0) throw new Error("no subagent provider is registered in this composition; cannot delegate");
	return names.includes(PREFERRED_PROVIDER) ? PREFERRED_PROVIDER : first;
}
/**
* 一个非 `completed` 的终态原因都算没干净收尾。
*
* 与官方实现一致：未知原因也按失败处理，而不是把部分输出当成成功。
* @param stopReason - 终态原因。
* @returns 失败说明；`completed` 时返回 `undefined`。
*/
function stopReasonError(stopReason) {
	switch (stopReason) {
		case "completed": return;
		case "aborted": return "subagent run was cancelled";
		case "error": return "subagent run failed";
		case "max-tokens": return "subagent run hit its token limit before finishing";
		case "refusal": return "subagent declined the task";
		default: return `subagent run ended abnormally (${stopReason})`;
	}
}
/**
* 拼接子代理输出里的文本块。
* @param blocks - 结果里的内容块。
* @returns 拼接后的文本。
*/
function textOf(blocks) {
	return blocks.filter((block) => typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
}
/**
* 把终态结果整理成委托结果；失败原因与部分输出分开呈现。
* @param runId - 子会话 id。
* @param result - 终态结果。
* @returns 委托结果。
*/
function toOutcome(provider, runId, result) {
	return {
		provider,
		runId,
		output: textOf(result.output),
		stopReason: result.stopReason,
		...result.diagnostic === void 0 ? {} : { diagnostic: result.diagnostic }
	};
}
/**
* 启动一次前台委托并收集结果，结束后释放运行。
* @param subagents - 子代理服务。
* @param providerName - 生效的 provider 名。
* @param prompt - 已构建的提示词（正文即委托任务）。
* @param label - 子代理任务的短标签。
* @param parent - 发起委托的 agent。
* @param signal - 调用方取消信号。
* @returns 委托结果。
* @throws {Error} 子代理未干净收尾时（说明里带上诊断与部分输出）。
*/
async function runForeground(subagents, providerName, prompt, label, parent, signal) {
	const run = await subagents.start(providerName, {
		label,
		prompt: [{
			type: "text",
			text: prompt
		}],
		parent,
		signal
	});
	const [execution] = await Promise.allSettled([run.result.then((result) => {
		const failure = stopReasonError(result.stopReason);
		if (failure === void 0) return toOutcome(providerName, run.id, result);
		const outcome = toOutcome(providerName, run.id, result);
		const diagnostic = outcome.diagnostic === void 0 ? "" : `\nDiagnostic: ${outcome.diagnostic}`;
		const partial = outcome.output === "" ? "" : `\nPartial output before the run ended:\n${outcome.output}`;
		throw new Error(`${failure}${diagnostic}${partial}`);
	})]);
	const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())]);
	if (execution.status === "rejected") {
		if (disposal.status === "rejected") throw new AggregateError([execution.reason, disposal.reason], `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`);
		throw execution.reason;
	}
	if (disposal.status === "rejected") throw disposal.reason;
	return execution.value;
}
//#endregion
//#region src/host/tool.ts
/**
* 模型可调用的结构化提示词构建工具。
*
* 与客户端表单**共用** `src/shared/prompt.ts` 的构建逻辑，因此两个入口产出的提示词
* 完全一致（段落顺序、省略规则、编号格式都是同一份实现）。参数与输出 schema 见
* `parameters.ts`，参数收窄见 `args.ts`，纯构建见 `build.ts`。
*
* 默认只**产出**提示词；带 `delegate` 时改为**直投子代理**（见 `subagents.ts`）—— 那时
* 提示词不再进入主上下文，这正是长提示词走这条路径的意义。
*
* **不 import 任何宿主包**：工具定义按 DSH 的 `ToolDefinition` 契约手工构造（理由见
* `parameters.ts`）。这是本插件在 `link:` 安装下能正常激活的前提 —— 宿主包只能从
* profile 的 node_modules 解析，而 link 经 junction 加载后 ESM 会 realpath 到源码目录，
* 那里没有任何 node_modules。
*/
/** 模型可见的工具名。 */
const STRUCTURED_PROMPT_TOOL = "build_structured_prompt";
/**
* 构造工具定义。
*
* 单独导出（而不是在模块顶层直接构造）是为了让测试能拿到定义直接调用 `execute` /
* `render`，无需启动一个 Cordis 上下文。
* @param ctx - host 侧插件上下文；省略时 `delegate` 会以"服务不可用"拒绝（其余能力不变）。
* @param config - 装载行里的插件配置；只影响 `delegate` 默认用哪个 provider。
* @returns registry-ready 的工具定义。
*/
function createStructuredPromptTool(ctx, config) {
	return {
		name: STRUCTURED_PROMPT_TOOL,
		description: TOOL_DESCRIPTION,
		parameters: TOOL_PARAMETERS_SCHEMA,
		output: {
			schema: TOOL_OUTPUT_SCHEMA,
			render: (_args, value) => {
				if (value.delegation !== "") {
					const body = value.delegated === "" ? "(the subagent produced no text output)" : value.delegated;
					return [{
						type: "text",
						text: `Delegated to a subagent (${value.delegation}); the built prompt was not added to this context.\n\n---\n${body}`
					}];
				}
				if (value.missing.length > 0) return [{
					type: "text",
					text: `${value.prompt}\n\n---\n(Required field(s) still empty: ${value.missing.join(", ")}.)`
				}];
				return [{
					type: "text",
					text: `${value.prompt}\n\n---\n(This text is now part of your context and is replayed on every later step; calling again with \`delegate\` keeps the next one out of it.)`
				}];
			}
		},
		async execute(args, exec) {
			const narrowed = narrowArgs(args);
			const built = buildFromArgs(narrowed);
			const delegate = narrowed.delegate;
			if (delegate === void 0) return {
				...built,
				delegated: "",
				delegation: ""
			};
			const subagents = ctx?.get?.("subagents");
			if (subagents === void 0) throw new Error("cannot delegate: the \"subagents\" service is not available in this composition; call without `delegate` to get the prompt instead");
			if (exec.agent === void 0) throw new Error("cannot delegate: this call has no owning agent to act as the parent");
			const outcome = await runForeground(subagents, resolveProviderName(subagents, prefer(delegate.provider, config?.provider)), built.prompt, prefer(delegate.label, STRUCTURED_PROMPT_TOOL), exec.agent, exec.signal);
			return {
				...built,
				delegated: outcome.output,
				delegation: `${outcome.provider}/${outcome.runId} (${outcome.stopReason})`
			};
		},
		/**
		* 用本次构建的目标做标题 —— 比工具名更能说明"在构建什么"。
		*
		* 刻意**不提供** `presentResult`：结果是整段提示词，通用卡片会沿用这个标题并直接读
		* durable 内容，再写一份 presentResult 只是把同一段大文本塞进视图载荷（DSH 的
		* `run_code` 工具也是这个取舍）。
		* @param args - 调用参数（形状未经校验，历史回放的参数可能与当前版本不同）。
		* @returns 卡片意图。
		*/
		presentCall(args) {
			const goal = typeof args === "object" && args !== null ? args.goal : void 0;
			return {
				card: "generic",
				title: typeof goal === "string" && goal.trim() !== "" ? goal.trim() : STRUCTURED_PROMPT_TOOL,
				kind: "other",
				rawInput: args
			};
		}
	};
}
/**
* 注册结构化提示词工具。
* @param ctx - host 侧插件上下文。
* @param config - 装载行里的插件配置（见 `config.ts`）。
* @returns 服务的返回值（取消注册函数）。
*/
function registerStructuredPromptTool(ctx, config) {
	return ctx.tools.register(createStructuredPromptTool(ctx, config));
}
//#endregion
//#region src/host/config.ts
/** 配置里允许出现的字段（不在其中的字段在装载期报错，而不是被静默忽略）。 */
const CONFIG_FIELDS = ["provider", "libraryBaseUrl"];
/**
* 解析一个绝对 URL。
* @param value - 待解析的字符串。
* @returns URL；解析失败时为 `undefined`。
*/
function parseAbsoluteUrl(value) {
	try {
		return new URL(value);
	} catch {
		return;
	}
}
/**
* 基础地址的问题说明。
*
* 用 `new URL` 判而不是正则：`https://` 拼不出地址，而 `https://host@evil.example` 的
* origin 其实是 `evil.example` —— 这两种笔误在装载期就该报出来，不该拖到第一次检索。
* @param value - 去空白后的基础地址。
* @returns 问题说明；合法时为 `undefined`。
*/
function baseUrlProblem(value) {
	const parsed = parseAbsoluteUrl(value);
	if (parsed === void 0) return "config.libraryBaseUrl must be a valid absolute URL";
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "config.libraryBaseUrl must use http:// or https://";
	if (parsed.username !== "" || parsed.password !== "") return "config.libraryBaseUrl must not carry credentials";
	if (parsed.hostname === "") return "config.libraryBaseUrl must include a host";
	if (parsed.search !== "" || parsed.hash !== "") return "config.libraryBaseUrl must not carry a query or fragment";
}
/**
* 收集配置的问题说明。
*
* `Config` 与 `narrowConfig` 共用它：一处判定、两种呈现（装载期 issue 列表 / 直接抛错），
* 否则两条路径迟早会分叉。
* @param raw - 装载行的 `config`；未写时为 `undefined`。
* @returns 问题说明；空数组表示合法。
*/
function configProblems(raw) {
	if (raw === void 0 || raw === null) return [];
	if (typeof raw !== "object" || Array.isArray(raw)) return ["config must be an object"];
	const record = raw;
	const problems = [];
	const unsupported = Object.keys(record).filter((key) => !CONFIG_FIELDS.includes(key));
	if (unsupported.length > 0) problems.push(`unsupported config field(s): ${unsupported.join(", ")}`);
	for (const key of CONFIG_FIELDS) {
		const value = record[key];
		if (value !== void 0 && value !== null && typeof value !== "string") problems.push(`config.${key} must be a string`);
	}
	const baseUrl = typeof record["libraryBaseUrl"] === "string" ? record["libraryBaseUrl"].trim() : "";
	if (baseUrl !== "") {
		const problem = baseUrlProblem(baseUrl);
		if (problem !== void 0) problems.push(problem);
	}
	return problems;
}
/**
* 取一个字符串配置项。
* @param record - 装载行的 `config`。
* @param key - 字段名。
* @returns 去首尾空白后的值；未配置、非字符串或纯空白时为空串。
*/
function stringField(record, key) {
	const value = record[key];
	return typeof value === "string" ? value.trim() : "";
}
/**
* 收窄装载行里的 `config`。
* @param raw - `cordis.patch.yml` 里该装载行的 `config`；未写时为 `undefined`。
* @returns 收窄后的配置；未配置（含 YAML 空值）时为空对象，等价于"用内建默认策略"。
* @throws {Error} 形状不合法时；问题说明与 `Config` 报的同源。
*/
function narrowConfig(raw) {
	const problems = configProblems(raw);
	if (problems.length > 0) throw new Error(`structured-prompt: invalid config — ${problems.join("; ")}`);
	if (typeof raw !== "object" || raw === null) return {};
	const record = raw;
	const provider = stringField(record, "provider");
	const libraryBaseUrl = stringField(record, "libraryBaseUrl").replace(/\/+$/, "");
	return {
		...provider === "" ? {} : { provider },
		...libraryBaseUrl === "" ? {} : { libraryBaseUrl }
	};
}
/**
* 装载行配置的 schema（standard-schema 形状，手写）。
*
* cordis 的 `resolveConfig` 只消费 `Config['~standard'].validate(config)`：返回 `{ value }`
* 就用它替换原始 config，返回 `{ issues }` 就在装载期抛 `ValidationError`，`apply` 根本不会
* 被调用。因此这里返回的是**收窄后**的配置，`apply` 拿到的已经是规范值。
*/
const Config = { "~standard": {
	version: 1,
	vendor: "dsh-plugin-structured-prompt",
	/**
	* 校验并规范化装载行配置。
	* @param value - 装载行的 `config`；未写时为 `undefined`。
	* @returns 合法时给出收窄后的配置，否则给出问题列表。
	*/
	validate(value) {
		const problems = configProblems(value);
		return problems.length > 0 ? { issues: problems.map((message) => ({ message })) } : { value: narrowConfig(value) };
	}
} };
//#endregion
//#region src/shared/library.ts
/** 上游基础地址的默认值；装载行的 `config.libraryBaseUrl` 可覆盖它（自托管）。 */
const DEFAULT_LIBRARY_BASE_URL = "https://prompts.chat";
/** 上游请求超时（毫秒）。 */
const LIBRARY_TIMEOUT_MS = 8e3;
/**
* 把条数夹到上游可接受的范围。
* @param raw - 调用方给的条数；`undefined` 或非有限数用默认值。
* @returns 1..{@link LIBRARY_MAX_LIMIT} 之间的整数。
*/
function clampLimit(raw) {
	if (raw === void 0 || !Number.isFinite(raw)) return 10;
	const rounded = Math.trunc(raw);
	if (rounded < 1) return 1;
	return rounded > 30 ? 30 : rounded;
}
/**
* 规范化查询词：折叠空白并截断。
* @param raw - 原始查询词。
* @returns 规范化后的查询词；全是空白时为空串。
*/
function normalizeQuery(raw) {
	const collapsed = raw.replace(/\s+/g, " ").trim();
	return collapsed.length > 120 ? collapsed.slice(0, 120) : collapsed;
}
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
		total: 0,
		source: ""
	};
	const record = raw;
	return {
		items: (Array.isArray(record["prompts"]) ? record["prompts"] : []).map(mapItem).filter((item) => item !== void 0),
		total: typeof record["total"] === "number" && Number.isFinite(record["total"]) ? record["total"] : 0,
		source: text(record["source"])
	};
}
//#endregion
//#region src/host/library-upstream.ts
/**
* 提示词库路由用到的上游请求与响应工具。
*
* 从 `library.ts` 拆出：那里留"路由怎么注册、handler 怎么处理"，这里留"怎么打上游、失败怎么
* 归一"。拆的直接原因是单文件行数上限（`tests/verify-install.mjs` 断言 260 行），顺带让上游
* 交互可以单独读。
*/
/**
* 统一的 JSON 响应。
* @param body - 响应体。
* @param status - HTTP 状态码。
* @returns 响应。
*/
function jsonResponse(body, status) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store"
		}
	});
}
/**
* 带超时地请求上游。
*
* 超时与浏览器取消取先到者；不向上游转发任何来自浏览器的头（只发 `accept`）。
* @param url - 完整的上游地址。
* @param fetchImpl - 请求实现。
* @param signal - 浏览器请求的取消信号。
* @returns 结局；网络层失败被归一成可读说明，不作为异常抛出。
*/
async function requestUpstream(url, fetchImpl, signal) {
	try {
		return {
			ok: true,
			response: await fetchImpl(url, {
				method: "GET",
				redirect: "error",
				headers: { accept: "application/json" },
				signal: AbortSignal.any([signal, AbortSignal.timeout(LIBRARY_TIMEOUT_MS)])
			})
		};
	} catch (error) {
		if (signal.aborted) return {
			ok: false,
			message: "请求已取消",
			status: 499
		};
		const timedOut = error instanceof Error && error.name === "TimeoutError";
		return {
			ok: false,
			message: timedOut ? `上游 ${LIBRARY_TIMEOUT_MS} 毫秒内没有响应` : `无法连接上游：${error instanceof Error ? error.message : String(error)}`,
			status: timedOut ? 504 : 502
		};
	}
}
/**
* 读取上游响应体里的 JSON。
* @param response - 上游响应。
* @returns 解析结果；不是 JSON 时给出失败说明。
*/
async function jsonBody(response) {
	try {
		return {
			ok: true,
			body: await response.json()
		};
	} catch {
		return {
			ok: false,
			message: "上游响应不是 JSON"
		};
	}
}
//#endregion
//#region src/host/library.ts
/**
* 提示词库检索的同源路由（host 半边）。
*
* **为什么必须由宿主代发**：上游 prompts.chat 不返回 CORS 头（预检返 204，却不回
* `Access-Control-Allow-Origin` / `Allow-Methods`），浏览器直连会被拒；宿主侧是 Node，
* 没有这个限制。浏览器因此只请求**同源**的这条路由。副作用是好的：上游地址成了宿主侧的
* 配置项（`config.libraryBaseUrl`），将来换自托管实例只改配置，插件代码不动。
*
* 安全边界（三条，都有断言守着）：
*  1. 基础地址只来自配置，**绝不由请求参数决定** —— 否则这条路由就是一个任意 URL 代理；
*  2. 记录 id 在拼进上游 URL 之前先按 `isValidItemId` 校验，挡掉路径注入；
*  3. 不向上游转发任何来自浏览器的请求头（含 cookie），只发一次只读 GET，8 秒超时，
*     并且**不跟随重定向**（`redirect: 'error'`）—— 跟出去就等于绕开配置里的地址。
*
* 上游请求与响应工具在 `library-upstream.ts`。
*/
/** 检索路由的绝对路径（`ConnectionFetchRoute.path` 含 `/api` 前缀，与既有上传路由同形）。 */
const LIBRARY_ROUTE_PATH = "/api/structured-prompt/library";
/** 取全文的路由路径。 */
const LIBRARY_ITEM_ROUTE_PATH = "/api/structured-prompt/library/item";
/**
* 生效的上游基础地址。
* @param config - 装载行配置。
* @returns 基础地址（已去掉末尾斜杠）。
*/
function libraryBaseUrl(config) {
	const configured = config?.libraryBaseUrl;
	return configured === void 0 || configured === "" ? DEFAULT_LIBRARY_BASE_URL : configured;
}
/**
* 拼一条上游地址。
*
* 用**相对路径**拼接（而不是 `/api/...` 这样的绝对路径）：自托管把实例挂在子路径下时
* （`https://host/sub`），绝对路径会静默丢掉 `/sub`。
* @param base - 基础地址。
* @param path - 以 `api/` 开头的相对路径。
* @returns 完整地址。
*/
function upstreamUrl(base, path) {
	return new URL(path, base.endsWith("/") ? base : `${base}/`);
}
/**
* 处理一次检索请求。
*
* 查询词为空时列出上游最新的一批（界面上"打开就有东西可看"），否则走 title 检索。
* @param request - 浏览器请求。
* @param config - 装载行配置（提供基础地址）。
* @param fetchImpl - 上游请求实现。
* @returns JSON 响应：`{ items, total }` 或 `{ error }`。
*/
async function handleLibrarySearch(request, config, fetchImpl) {
	if (request.method !== "GET") return new Response(null, {
		status: 405,
		headers: { allow: "GET" }
	});
	const params = new URL(request.url).searchParams;
	const query = normalizeQuery(params.get("q") ?? "");
	const limit = clampLimit(Number(params.get("limit") ?? NaN));
	const base = libraryBaseUrl(config);
	const upstream = query === "" ? upstreamUrl(base, "api/prompts") : upstreamUrl(base, "api/prompts/search");
	if (query === "") upstream.searchParams.set("perPage", String(limit));
	else {
		upstream.searchParams.set("q", query);
		upstream.searchParams.set("limit", String(limit));
	}
	const outcome = await requestUpstream(upstream.toString(), fetchImpl, request.signal);
	if (!outcome.ok) return jsonResponse({ error: outcome.message }, outcome.status);
	if (!outcome.response.ok) return jsonResponse({ error: `上游返回 ${outcome.response.status}` }, 502);
	const parsed = await jsonBody(outcome.response);
	if (!parsed.ok) return jsonResponse({ error: parsed.message }, 502);
	const mapped = mapSearchResponse(parsed.body);
	const origin = new URL(base);
	const path = origin.pathname.replace(/\/+$/, "");
	return jsonResponse({
		...mapped,
		source: `${origin.host}${path}`
	}, 200);
}
/**
* 处理一次"取全文"请求。
* @param request - 浏览器请求。
* @param config - 装载行配置（提供基础地址）。
* @param fetchImpl - 上游请求实现。
* @returns JSON 响应：`{ item }` 或 `{ error }`。
*/
async function handleLibraryItem(request, config, fetchImpl) {
	if (request.method !== "GET") return new Response(null, {
		status: 405,
		headers: { allow: "GET" }
	});
	const id = new URL(request.url).searchParams.get("id") ?? "";
	if (!isValidItemId(id)) return jsonResponse({ error: "id 不合法" }, 400);
	const outcome = await requestUpstream(upstreamUrl(libraryBaseUrl(config), `api/prompts/${id}`).toString(), fetchImpl, request.signal);
	if (!outcome.ok) return jsonResponse({ error: outcome.message }, outcome.status);
	if (!outcome.response.ok) {
		if (outcome.response.status === 404) return jsonResponse({ error: "上游没有这条提示词" }, 404);
		return jsonResponse({ error: `上游返回 ${outcome.response.status}` }, 502);
	}
	const parsed = await jsonBody(outcome.response);
	if (!parsed.ok) return jsonResponse({ error: parsed.message }, 502);
	const detail = mapDetail(parsed.body);
	if (detail === void 0) return jsonResponse({ error: "上游返回的记录缺少正文" }, 502);
	return jsonResponse({ item: detail }, 200);
}
/**
* 注册提示词库的两条只读路由。
*
* **注册必须走 `ctx.inject`，不能在 `apply` 期用 `ctx.get` 读一次**：加载器的 entry 是
* **并行**创建的（`vendor/loader/src/config/group.ts` 的 `Promise.allSettled`），各 entry 的
* `apply` 先后没有保证；而 `connection` 的 fiber 要等 `credentials`，依赖链比本插件的 `tools`
* 长 —— 在 `apply` 期读一次很可能读到"还没就绪"，然后**永久**跳过注册、且没有任何报错
* （浏览器那边只看到共享通道的 404）。DSH 自己的 web 载体注册也是这么做的
* （`packages/client/modules` 里的 `ctx.inject(['webServer'], registerWebCarrier)`）。
*
* 回调**必须用它的参数作用域**（`scoped`）来读服务与挂副作用：`ctx.inject` 的回调运行在新建
* 的子 fiber 上，副作用挂在子 fiber 才会"依赖失去时释放"；挂在外层 ctx 上只有插件卸载时才释放。
*
* 没有 `connection`（该组装没有 web 载体）时不注册任何东西 —— 那是设计内的降级；缺少
* `inject` / `effect` 面则属于异常组装，留一条日志而不是静默跳过。
* @param ctx - host 侧插件上下文。
* @param config - 装载行配置。
* @param deps - 可注入的上游请求实现（测试用）。
*/
function registerLibraryRoute(ctx, config, deps) {
	if (typeof ctx.inject !== "function") {
		console.warn("[structured-prompt] 提示词库路由未注册：host 上下文没有 ctx.inject 面");
		return;
	}
	const fetchImpl = deps?.fetchImpl ?? ((url, init) => fetch(url, init));
	/**
	* 构造一条只读路由。
	* @param path - 绝对路径。
	* @param handler - 处理函数。
	* @returns 路由描述。
	*/
	const route = (path, handler) => ({
		path,
		methods: ["GET"],
		requestBody: "buffered",
		fetch: (request) => handler(request)
	});
	ctx.inject(["connection"], (scoped) => {
		const fetchFace = (scoped.get?.("connection"))?.fetch;
		const register = fetchFace?.register;
		if (register === void 0 || fetchFace === void 0) return;
		if (typeof scoped.effect !== "function") {
			console.warn("[structured-prompt] 提示词库路由未注册：connection 就绪了，但作用域没有 ctx.effect 面");
			return;
		}
		scoped.effect(() => register.call(fetchFace, route(LIBRARY_ROUTE_PATH, (request) => handleLibrarySearch(request, config, fetchImpl))), "structured-prompt: library search route");
		scoped.effect(() => register.call(fetchFace, route(LIBRARY_ITEM_ROUTE_PATH, (request) => handleLibraryItem(request, config, fetchImpl))), "structured-prompt: library item route");
	});
}
//#endregion
//#region src/index.ts
/**
* host 侧依赖：只需要工具注册面。
*
* 声明为硬依赖（而不是 `ctx.get` 可选读取）是有意的 —— 没有 `tools` 服务时本半边
* 无事可做，静默变成空插件反而更难排查。提示词库的两条路由不走这里：它们在
* `ctx.inject(['connection'], …)` 的就绪回调里注册（`host/library.ts`），没有 web 载体的组装里
* 自然不注册，其余能力不变。
*/
const inject = ["tools"];
/**
* 插件 host 主体。
* @param ctx - host 上下文。
* @param config - 装载行的 `config`。cordis 已经用 `Config` 校验并规范化过；这里再收窄一次
*   是为了 `apply` 被直接调用（测试、其它组装）时同样安全 —— 形状不对就抛错，不静默忽略。
*/
function apply(ctx, config) {
	const narrowed = narrowConfig(config);
	registerStructuredPromptTool(ctx, narrowed);
	registerLibraryRoute(ctx, narrowed);
}
//#endregion
export { Config, apply, inject };
