/**
 * Strict GitHub owner/repo + raw-path helpers.
 * Used by egg import so user-supplied repo slugs cannot change the request host.
 */

const OWNER_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEFAULT_EGG_REPO = "pterodactyl/game-eggs";

export function parseGithubOwnerRepo(input?: string | null): string {
	const slug = (input && input.trim()) || DEFAULT_EGG_REPO;
	if (!OWNER_REPO_RE.test(slug) || slug.includes("..")) {
		throw new Error("Invalid GitHub repository. Expected owner/repo.");
	}
	return slug;
}

export function githubRepoTreeUrl(ownerRepo: string, branch = "main"): URL {
	const slug = parseGithubOwnerRepo(ownerRepo);
	const url = new URL(
		`https://api.github.com/repos/${slug}/git/trees/${encodeURIComponent(branch)}`,
	);
	url.searchParams.set("recursive", "1");
	if (url.protocol !== "https:" || url.hostname !== "api.github.com") {
		throw new Error("Refusing non-GitHub API URL");
	}
	return url;
}

const UNSAFE_PATH_RE = /(^|\/)\.\.(\/|$)|^[\\/]|[\\:]/;

export function githubRawFileUrl(
	ownerRepo: string,
	branch: string,
	filePath: string,
): URL {
	const slug = parseGithubOwnerRepo(ownerRepo);
	if (!filePath || UNSAFE_PATH_RE.test(filePath) || filePath.includes("\0")) {
		throw new Error("Invalid repository file path");
	}
	const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
	const url = new URL(
		`https://raw.githubusercontent.com/${slug}/${encodeURIComponent(branch)}/${encodedPath}`,
	);
	if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com") {
		throw new Error("Refusing non-GitHub raw URL");
	}
	return url;
}
