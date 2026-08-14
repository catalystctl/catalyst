/**
 * GitHub owner/repo + raw URL helpers used by egg import.
 * Guards against SSRF via user-supplied repo slugs.
 */
import { describe, it, expect } from "vitest";
import {
  githubRawFileUrl,
  githubRepoTreeUrl,
  parseGithubOwnerRepo,
} from "../lib/github-repo";

describe("parseGithubOwnerRepo", () => {
  it("defaults to pterodactyl/game-eggs", () => {
    expect(parseGithubOwnerRepo()).toBe("pterodactyl/game-eggs");
    expect(parseGithubOwnerRepo("")).toBe("pterodactyl/game-eggs");
    expect(parseGithubOwnerRepo("   ")).toBe("pterodactyl/game-eggs");
  });

  it("accepts owner/repo slugs", () => {
    expect(parseGithubOwnerRepo("pterodactyl/game-eggs")).toBe("pterodactyl/game-eggs");
    expect(parseGithubOwnerRepo("Some-Org/my.repo_1")).toBe("Some-Org/my.repo_1");
  });

  it("rejects host injection and path traversal", () => {
    expect(() => parseGithubOwnerRepo("https://evil.example/repo")).toThrow(/Invalid GitHub repository/);
    expect(() => parseGithubOwnerRepo("owner/repo/extra")).toThrow(/Invalid GitHub repository/);
    expect(() => parseGithubOwnerRepo("../etc/passwd")).toThrow(/Invalid GitHub repository/);
    expect(() => parseGithubOwnerRepo("owner/..")).toThrow(/Invalid GitHub repository/);
    expect(() => parseGithubOwnerRepo("owner/repo?foo=1")).toThrow(/Invalid GitHub repository/);
    expect(() => parseGithubOwnerRepo("owner/repo#frag")).toThrow(/Invalid GitHub repository/);
    expect(() => parseGithubOwnerRepo("owner/repo@evil")).toThrow(/Invalid GitHub repository/);
  });
});

describe("githubRepoTreeUrl", () => {
  it("pins the request to api.github.com", () => {
    const url = githubRepoTreeUrl("pterodactyl/game-eggs", "main");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("api.github.com");
    expect(url.pathname).toBe("/repos/pterodactyl/game-eggs/git/trees/main");
    expect(url.searchParams.get("recursive")).toBe("1");
  });
});

describe("githubRawFileUrl", () => {
  it("pins the request to raw.githubusercontent.com", () => {
    const url = githubRawFileUrl("pterodactyl/game-eggs", "main", "minecraft/egg-paper.json");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("raw.githubusercontent.com");
    expect(url.pathname).toBe("/pterodactyl/game-eggs/main/minecraft/egg-paper.json");
  });

  it("rejects traversal and absolute paths", () => {
    expect(() => githubRawFileUrl("pterodactyl/game-eggs", "main", "../secret")).toThrow(/Invalid repository file path/);
    expect(() => githubRawFileUrl("pterodactyl/game-eggs", "main", "/etc/passwd")).toThrow(/Invalid repository file path/);
    expect(() => githubRawFileUrl("pterodactyl/game-eggs", "main", "foo\\bar")).toThrow(/Invalid repository file path/);
  });
});
