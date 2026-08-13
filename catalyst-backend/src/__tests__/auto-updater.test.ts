import { afterEach, describe, expect, it } from "vitest";
import {
	formatDockerUpdateError,
	getComposePath,
	performUpdate,
} from "../services/auto-updater";

const originalEnv = {
	compose: process.env.AUTO_UPDATE_DOCKER_COMPOSE_PATH,
	force: process.env.AUTO_UPDATE_FORCE_DOCKER,
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

describe("getComposePath", () => {
	it("uses AUTO_UPDATE_DOCKER_COMPOSE_PATH when set", () => {
		process.env.AUTO_UPDATE_DOCKER_COMPOSE_PATH =
			"/root/catalyst-docker/docker-compose.yml";
		expect(getComposePath()).toBe("/root/catalyst-docker/docker-compose.yml");
	});
});

describe("performUpdate", () => {
	it("fails when the compose file is missing in docker mode", async () => {
		process.env.AUTO_UPDATE_FORCE_DOCKER = "true";
		process.env.AUTO_UPDATE_DOCKER_COMPOSE_PATH =
			"/tmp/catalyst-missing-compose.yml";
		const result = await performUpdate();
		expect(result.success).toBe(false);
		expect(result.message).toMatch(/not found/);
	});
});
