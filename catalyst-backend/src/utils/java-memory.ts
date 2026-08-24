/**
 * JVM cgroup accounting — must stay in lockstep with
 * catalyst-agent `shell_utils::{java_cgroup_overhead_mb, looks_like_java, plan_java_memory}`.
 *
 * Advertised `allocatedMemoryMb` is the heap. The agent inflates the cgroup so
 * off-heap (direct/metaspace/threads) does not steal that heap. Node placement
 * has to count the inflated size or the host is overcommitted.
 */

export const SERVER_CGROUP_MEMORY_SELECT = {
	allocatedMemoryMb: true,
	startupCommand: true,
	environment: true,
	template: { select: { startup: true, image: true } },
} as const;

export type JavaMemoryServer = {
	allocatedMemoryMb: number;
	startupCommand?: string | null;
	environment?: unknown;
	template?: { startup?: string | null; image?: string | null } | null;
};

export function javaCgroupOverheadMb(heapMb: number): number {
	if (!Number.isFinite(heapMb) || heapMb <= 0) return 0;
	if (heapMb < 256) return 64;
	return Math.min(1024, Math.max(640, Math.floor((heapMb * 30) / 100)));
}

export function looksLikeJava(startup?: string | null, image?: string | null): boolean {
	const s = (startup ?? "").toLowerCase();
	const i = (image ?? "").toLowerCase();
	return (
		s.includes("java") ||
		s.includes(".jar") ||
		i.includes("temurin") ||
		i.includes("openjdk") ||
		i.includes("graal") ||
		i.includes("zulu") ||
		i.includes("adoptium") ||
		i.includes("liberica") ||
		i.includes("semeru") ||
		i.includes("hotspot") ||
		i.includes("java") ||
		i.includes("jdk") ||
		i.includes("jre")
	);
}

function envFlag(environment: unknown, key: string): string | undefined {
	if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
		return undefined;
	}
	const value = (environment as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

/** Cgroup memory.max the agent will apply for this server. */
export function serverCgroupMemoryMb(server: JavaMemoryServer): number {
	const allocated = server.allocatedMemoryMb || 0;
	if (envFlag(server.environment, "CATALYST_JAVA_MEMORY_FIX") === "0") {
		return allocated;
	}
	const startup = server.startupCommand || server.template?.startup || "";
	const image = envFlag(server.environment, "TEMPLATE_IMAGE") || server.template?.image || "";
	if (!looksLikeJava(startup, image)) {
		return allocated;
	}
	return allocated + javaCgroupOverheadMb(allocated);
}

export function sumCgroupMemoryMb(servers: JavaMemoryServer[]): number {
	return servers.reduce((sum, server) => sum + serverCgroupMemoryMb(server), 0);
}

/** Placement cost for a not-yet-persisted server. */
export function requestedCgroupMemoryMb(
	allocatedMb: number,
	opts: {
		startup?: string | null;
		image?: string | null;
		environment?: unknown;
	},
): number {
	return serverCgroupMemoryMb({
		allocatedMemoryMb: allocatedMb,
		startupCommand: opts.startup,
		environment: opts.environment,
		template: { startup: opts.startup, image: opts.image },
	});
}
