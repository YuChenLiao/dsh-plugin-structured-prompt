/**
 * 从 Cordis 上下文里取"必须带某些方法"的服务。
 *
 * 探测一律尽力而为：`ctx.get` 在服务未挂载时返回 `undefined`（某些实现还会抛），两条都要吃掉。
 * 单独一个文件是为了让右侧栏的两条后端（`sidebar.ts` 的宿主原生、`sidebar-better.ts` 的
 * dsh-better-sidebar）共用同一份判据，又不互相 import。
 */
import type { ClientPluginContext } from '../../../shared/plugin-context.js'

/**
 * 取一个服务，并校验它带齐了要用到的方法。
 * @param ctx - 插件上下文（可以是 `ctx.inject` 给的子上下文）。
 * @param name - 服务名。
 * @param methods - 必需的方法名，缺一个就算不可用。
 * @returns 服务，或不可用时 `undefined`。
 */
export function serviceOf<T>(ctx: ClientPluginContext, name: string, ...methods: string[]): T | undefined {
  let value: unknown
  try {
    value = ctx.get(name)
  } catch {
    return undefined
  }
  if (value === undefined || value === null) return undefined
  const face = value as Record<string, unknown>
  if (!methods.every(method => typeof face[method] === 'function')) return undefined
  return value as T
}

/**
 * 报告若干服务此刻的样子（只给降级说明用）。
 * @param ctx - 插件上下文。
 * @param probes - 每项是「服务名 + 必需方法」。
 * @returns 形如 `betterSidebar=有 / sidebarRightTabs=无` 的短串。
 */
export function describeServices(
  ctx: ClientPluginContext,
  probes: ReadonlyArray<readonly [string, ...string[]]>,
): string {
  return probes
    .map(([name, ...methods]) => `${name}=${serviceOf<unknown>(ctx, name, ...methods) === undefined ? '无' : '有'}`)
    .join(' / ')
}
