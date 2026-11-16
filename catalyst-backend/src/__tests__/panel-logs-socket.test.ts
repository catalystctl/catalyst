/**
 * Panel log export vs. the container engine socket.
 *
 * Audit S1-7: the backend no longer gets /var/run/docker.sock by default. The
 * export must therefore (a) still work when the socket IS mounted, and (b) say
 * something useful and non-alarming when it is not, instead of surfacing a raw
 * `docker: Cannot connect to the Docker daemon` string as if the install were
 * broken.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	collectPanelLogs,
	type CommandRunner,
} from "../services/diagnostics/panel-logs";

const WINDOW = {
	since: new Date("2026-11-15T00:00:00Z"),
	until: new Date("2026-11-15T01:00:00Z"),
};

/** A socket path that exists, so the "socket mounted" branch is exercised. */
function tempSocket(): { dir: string; socket: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-sock-"));
	const socket = path.join(dir, "docker.sock");
	fs.writeFileSync(socket, "");
	return { dir, socket };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("collectPanelLogs without a container engine socket (default deployment)", () => {
	it("reports the deployment posture, not a daemon connection error", async () => {
		const runner = vi.fn<CommandRunner>(async () => ({
			stdout: "",
			stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
			exitCode: 1,
			truncated: false,
		}));

		const result = await collectPanelLogs({
			...WINDOW,
			runner,
			env: { DOCKER_SOCKET_PATH: "/nonexistent/catalyst/docker.sock" },
		});

		expect(result.source).toBe("unavailable");
		expect(result.lines).toBe(0);
		expect(result.warning).toMatch(/socket is not mounted/i);
		expect(result.warning).toMatch(/intentional/i);
	});

	it("still attempts the read so an opt-in deployment keeps working", async () => {
		const { dir, socket } = tempSocket();
		const runner = vi.fn<CommandRunner>(async () => ({
			stdout: "2026-11-15T00:01:00Z panel ready\n",
			stderr: "",
			exitCode: 0,
			truncated: false,
		}));

		const result = await collectPanelLogs({
			...WINDOW,
			runner,
			env: { DOCKER_SOCKET_PATH: socket },
		});

		expect(runner).toHaveBeenCalled();
		expect(result.source).toBe("docker");
		expect(result.content).toContain("panel ready");
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
