//#region src/components/library/shared/library.ts
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
//#region src/components/library/host/library-upstream.ts
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
//#region src/components/library/host/library.ts
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
//#region src/components/library/host/config.ts
/** 配置里允许出现的字段。 */
const CONFIG_FIELDS = ["libraryBaseUrl"];
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
* 用 `new URL` 判而不是正则：`https://` 拼不出地址，`https://host@evil.example` 的 origin 其实是
* `evil.example`，带 query/fragment 的写法会静默改掉拼出来的路径 —— 这些笔误在装载期就该报出来。
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
	const baseUrl = record["libraryBaseUrl"];
	if (baseUrl !== void 0 && baseUrl !== null && typeof baseUrl !== "string") problems.push("config.libraryBaseUrl must be a string");
	const text = typeof baseUrl === "string" ? baseUrl.trim() : "";
	if (text !== "") {
		const problem = baseUrlProblem(text);
		if (problem !== void 0) problems.push(problem);
	}
	return problems;
}
/**
* 收窄装载行里的 `config`。
* @param raw - 装载行的 `config`；未写时为 `undefined`。
* @returns 收窄后的配置；未配置（含 YAML 空值）时为空对象。
* @throws {Error} 形状不合法时；问题说明与 `Config` 报的同源。
*/
function narrowConfig(raw) {
	const problems = configProblems(raw);
	if (problems.length > 0) throw new Error(`prompt-library: invalid config — ${problems.join("; ")}`);
	if (typeof raw !== "object" || raw === null) return {};
	const value = raw["libraryBaseUrl"];
	if (typeof value !== "string") return {};
	const trimmed = value.trim().replace(/\/+$/, "");
	return trimmed === "" ? {} : { libraryBaseUrl: trimmed };
}
/**
* 装载行配置的 schema（standard-schema 形状，手写）。
*/
const Config = { "~standard": {
	version: 1,
	vendor: "dsh-plugin-structured-prompt-library",
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
//#region src/components/library/index.ts
/** host 侧依赖：本组件不需要任何硬依赖。 */
const inject = [];
/**
* 组件主体。
* @param ctx - host 上下文（只需要可选读取与 `ctx.inject` / `ctx.effect` 面）。
* @param config - 装载行的 `config`；形状不对就抛错，不静默忽略。
*/
function apply(ctx, config) {
	registerLibraryRoute(ctx, narrowConfig(config));
}
//#endregion
export { Config, apply, inject };
