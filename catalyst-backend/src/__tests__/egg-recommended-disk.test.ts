import { describe, expect, it } from "vitest";
import {
	importPterodactylEgg,
	minimumDiskMbFromHints,
	recommendedDiskForEgg,
	type PteroEgg,
} from "../utils/egg-import";

describe("recommendedDiskForEgg", () => {
	it("requires 40 GB for CS2 app 730", () => {
		const egg = {
			name: "Counter-Strike 2",
			features: ["steam_disk_space"],
			variables: [
				{
					name: "Source AppID",
					env_variable: "SRCDS_APPID",
					default_value: "730",
				},
			],
		} as PteroEgg;
		expect(recommendedDiskForEgg(egg)).toBe(40960);
	});

	it("uses 20 GB for steam_disk_space without a known app id", () => {
		const egg = {
			name: "Steam Game",
			features: ["steam_disk_space"],
			variables: [],
		} as PteroEgg;
		expect(recommendedDiskForEgg(egg)).toBe(20480);
	});

	it("keeps the 10 GB default for non-steam eggs", () => {
		const egg = {
			name: "Paper",
			features: [],
			variables: [],
		} as PteroEgg;
		expect(recommendedDiskForEgg(egg)).toBe(10240);
	});

	it("exposes the recommendation as the imported template's disk default", () => {
		const result = importPterodactylEgg({
			name: "Counter-Strike 2",
			author: "Test",
			features: ["steam_disk_space"],
			docker_images: { java: "ghcr.io/pterodactyl/yolks:java_21" },
			startup: "java -jar server.jar",
			config: { stop: "stop" },
			scripts: { installation: { script: "echo install" } },
			variables: [
				{
					name: "Source AppID",
					env_variable: "SRCDS_APPID",
					default_value: "730",
				},
			],
		} as PteroEgg);
		expect(result.allocatedDiskMb).toBe(40960);
		// Kept for older templates that only read the feature hint.
		expect((result.features as Record<string, unknown>).recommendedDiskMb).toBe(40960);
	});
});

describe("minimumDiskMbFromHints", () => {
	it("prefers a stored template minimum", () => {
		expect(
			minimumDiskMbFromHints({
				appId: "730",
				storedMinimum: 50000,
			}),
		).toBe(50000);
	});

	it("maps CS2 from app id on already-imported eggs", () => {
		expect(
			minimumDiskMbFromHints({
				appId: "730",
				pterodactylFeatures: ["steam_disk_space"],
			}),
		).toBe(40960);
	});
});
