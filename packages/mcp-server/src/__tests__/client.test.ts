import { describe, expect, it, vi, afterEach } from "vitest";
import { CatalystClient, CatalystApiError } from "../client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CatalystClient", () => {
  it("sends the API key as a bearer token and unwraps the data envelope", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { id: "srv_1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new CatalystClient({
      panelBase: "https://panel.example.com",
      apiBase: "https://panel.example.com/api",
      apiKey: "catalyst_test",
    });
    const result = await client.get("/servers/srv_1");

    expect(result).toEqual({ id: "srv_1" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://panel.example.com/api/servers/srv_1");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer catalyst_test",
    );
  });

  it("raises CatalystApiError with the panel error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Not found", code: "NOT_FOUND" }, 404)),
    );
    const client = new CatalystClient({
      panelBase: "https://panel.example.com",
      apiBase: "https://panel.example.com/api",
      apiKey: "catalyst_test",
    });
    const error = await client.get("/servers/missing").catch((e) => e);
    expect(error).toBeInstanceOf(CatalystApiError);
    expect((error as CatalystApiError).status).toBe(404);
    expect((error as CatalystApiError).code).toBe("NOT_FOUND");
  });
});
