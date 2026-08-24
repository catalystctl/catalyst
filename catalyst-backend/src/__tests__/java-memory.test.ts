import { describe, it, expect } from "vitest";
import {
	javaCgroupOverheadMb,
	looksLikeJava,
	requestedCgroupMemoryMb,
	serverCgroupMemoryMb,
	sumCgroupMemoryMb,
} from "../utils/java-memory";

describe("javaCgroupOverheadMb", () => {
	it("matches the agent: 2GB heap → 640MB overhead", () => {
		expect(javaCgroupOverheadMb(2048)).toBe(640);
		expect(requestedCgroupMemoryMb(2048, { startup: "java -jar server.jar", image: "eclipse-temurin:21-jre" })).toBe(
			2688,
		);
	});

	it("caps overhead at 1024MB", () => {
		expect(javaCgroupOverheadMb(8192)).toBe(1024);
	});
});

describe("looksLikeJava", () => {
	it("detects Minecraft images and not CS2", () => {
		expect(looksLikeJava("java -Xmx{{MEMORY}}M -jar server.jar", "eclipse-temurin:21-jre")).toBe(true);
		expect(looksLikeJava("./run.sh", "ghcr.io/pterodactyl/yolks:java_21")).toBe(true);
		expect(looksLikeJava("./srcds_run -game csgo", "cm2network/csgo")).toBe(false);
		expect(looksLikeJava("echo hello", "alpine:latest")).toBe(false);
	});
});

describe("serverCgroupMemoryMb", () => {
	it("does not inflate non-Java servers", () => {
		expect(
			serverCgroupMemoryMb({
				allocatedMemoryMb: 2048,
				startupCommand: "echo hello",
				template: { startup: "echo hello", image: "alpine:latest" },
			}),
		).toBe(2048);
	});

	it("honors CATALYST_JAVA_MEMORY_FIX=0", () => {
		expect(
			serverCgroupMemoryMb({
				allocatedMemoryMb: 2048,
				startupCommand: "java -jar server.jar",
				environment: { CATALYST_JAVA_MEMORY_FIX: "0" },
				template: { image: "eclipse-temurin:21-jre" },
			}),
		).toBe(2048);
	});

	it("sums mixed Java and non-Java occupancy", () => {
		expect(
			sumCgroupMemoryMb([
				{
					allocatedMemoryMb: 2048,
					startupCommand: "java -jar server.jar",
					template: { image: "eclipse-temurin:21-jre" },
				},
				{
					allocatedMemoryMb: 2048,
					startupCommand: "./srcds_run",
					template: { image: "cm2network/csgo" },
				},
			]),
		).toBe(2688 + 2048);
	});
});
