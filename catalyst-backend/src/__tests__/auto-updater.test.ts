import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
	composeFilesFromLabels,
	composePathFromLabels,
	formatDockerUpdateError,
	getComposePath,
	getUpdateState,
	performUpdate,
} from "../services/auto-updater";

const originalEnv = {
	compose: process.env.AUTO_UPDATE_DOCKER_COMPOSE_PATH,
	force: process.env.AUTO_UPDATE_FORCE_DOCKER,
	docker: process.env.DOCKER_BIN,
};

afterEach(() => {
	if (originalEnv.compose === undefined) {
		delete process.env.AUTO_UPDATE_DOCKER_COMPOSE_PATH;
	} else {
		process.env.AUTO_UPDATE_DOCKER_COMPOSE_PATH = originalEnv.compose;
	}
	if (originalEnv.force === undefined) {
		delete process.env.AUTO_UPDATE_FORCE_DOCKER;
	} else {
		process.env.AUTO_UPDATE_FORCE_DOCKER = originalEnv.force;
	}
	if (originalEnv.docker === undefined) {
		delete process.env.DOCKER_BIN;
	} else {
		process.env.DOCKER_BIN = originalEnv.docker;
	}
});

describe("formatDockerUpdateError", () => {
	it("maps spawn ENOENT to a docker CLI missing message", () => {
		const error = Object.assign(new Error("spawn docker ENOENT"), {
			code: "ENOENT",
		});
		expect(formatDockerUpdateError(error)).toMatch(/docker CLI is not available/);
	});

	it("keeps a generic docker error message", () => {
		expect(formatDockerUpdateError(new Error("permission denied"))).toBe(
			"permission denied",
		);
	});
});

describe("composePathFromLabels", () => {
	it("prefers the first compose config file label", () => {
		expect(
			composePathFromLabels({
				"com.docker.compose.project.config_files":
					"/root/catalyst-docker/docker-compose.yml,/root/catalyst-docker/docker-compose.overlay.yml",
				"com.docker.compose.project.working_dir": "/root/catalyst-docker",
			}),
		).toBe("/root/catalyst-docker/docker-compose.yml");
		expect(
			composeFilesFromLabels({
				"com.docker.compose.project.config_files":
					"/root/catalyst-docker/docker-compose.yml,/root/catalyst-docker/docker-compose.overlay.yml",
			}),
		).toEqual([
			"/root/catalyst-docker/docker-compose.yml",
			"/root/catalyst-docker/docker-compose.overlay.yml",
		]);
	});

	it("falls back to working_dir/docker-compose.yml", () => {
		expect(
			composePathFromLabels({
				"com.docker.compose.project.working_dir": "/opt/catalyst-docker",
			}),
		).toBe("/opt/catalyst-docker/docker-compose.yml");
	});

	it("returns null when compose labels are missing", () => {
		expect(composePathFromLabels({})).toBeNull();
	});
});

describe("getComposePath", () => {
	it("uses AUTO_UPDATE_DOCKER_COMPOSE_PATH when the file exists", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-compose-"));
		const compose = path.join(dir, "docker-compose.yml");
		fs.writeFileSync(compose, "services: {}\n");
		process.env.AUTO_UPDATE_DOCKER_COMPOSE_PATH = compose;
		expect(getComposePath()).toBe(compose);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("performUpdate", () => {
	it("fails when docker cannot run a compose update", async () => {
		process.env.AUTO_UPDATE_FORCE_DOCKER = "true";
		delete process.env.AUTO_UPDATE_DOCKER_COMPOSE_PATH;
		process.env.DOCKER_BIN = "/tmp/catalyst-no-such-docker";
		// Stand in a socket so this exercises the CLI-failure path rather than
		// the no-socket gate covered below.
		process.env.DOCKER_SOCKET_PATH = "/tmp/catalyst-fake.sock";
		fs.writeFileSync(process.env.DOCKER_SOCKET_PATH, "");
		const result = await performUpdate();
		fs.rmSync(process.env.DOCKER_SOCKET_PATH, { force: true });
		delete process.env.DOCKER_SOCKET_PATH;
		expect(result.success).toBe(false);
		expect(result.message).toMatch(
			/Could not find docker-compose.yml|docker CLI is not available|not found/,
		);
	});

	it("refuses to update when the engine socket is not mounted (audit S1-7)", async () => {
		process.env.AUTO_UPDATE_FORCE_DOCKER = "true";
		process.env.DOCKER_SOCKET_PATH = "/nonexistent/catalyst/docker.sock";
		const result = await performUpdate();
		delete process.env.DOCKER_SOCKET_PATH;
		expect(result.success).toBe(false);
		// The message explains the deployment posture, not a docker failure.
		expect(result.message).toMatch(/socket is not mounted/i);
		expect(result.message).toMatch(/default/i);
		expect(getUpdateState().state).toBe("failed");
	});
});

describe("update state machine", () => {
	it("reports failed with the error message when a direct-mode update is attempted", async () => {
		delete process.env.AUTO_UPDATE_FORCE_DOCKER;
		process.env.AUTO_UPDATE_FORCE_DOCKER = "false";
		// Direct mode (isDocker() false in test env) always fails with guidance.
		const result = await performUpdate();
		expect(result.success).toBe(false);
		const state = getUpdateState();
		expect(state.state).toBe("failed");
		expect(state.message).toMatch(/manual/i);
		expect(state.updatedAt).toBeTruthy();
	});
});
