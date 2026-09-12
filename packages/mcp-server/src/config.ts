export interface CatalystConfig {
  panelBase: string;
  apiBase: string;
  apiKey: string;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): CatalystConfig {
  const rawUrl =
    env.CATALYST_URL ?? env.CATALYST_PANEL_URL ?? env.CATALYST_BASE_URL ?? "";
  const apiKey = env.CATALYST_API_KEY ?? env.CATALYST_TOKEN ?? "";
  if (!rawUrl) {
    throw new Error(
      "Missing panel URL. Set CATALYST_URL (e.g. https://panel.example.com).",
    );
  }
  if (!apiKey) {
    throw new Error(
      "Missing API key. Set CATALYST_API_KEY to a catalyst_... key from Profile > API keys.",
    );
  }
  const panelBase = trimTrailingSlashes(rawUrl.trim());
  const apiBase = panelBase.endsWith("/api")
    ? panelBase
    : `${panelBase}/api`;
  return { panelBase, apiBase, apiKey };
}

export function configSummary(config: CatalystConfig): string {
  const redacted = config.apiKey.length > 12
    ? `${config.apiKey.slice(0, 10)}...${config.apiKey.slice(-4)}`
    : "***";
  return `panel=${config.panelBase} key=${redacted}`;
}
