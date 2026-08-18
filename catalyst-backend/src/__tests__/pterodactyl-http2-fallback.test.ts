/**
 * HTTP/2 → HTTP/1.1 fallback matcher for the Pterodactyl migration client.
 */
import { describe, it, expect } from "vitest";
import { shouldFallbackFromHttp2 } from "../services/migration/pterodactyl-client";

describe("shouldFallbackFromHttp2", () => {
  it("matches the user-facing OpenSSL ALPN bad-extension error", () => {
    const msg =
      "58121A222D720000:error:0A00006E:SSL routines:tls_parse_stoc_alpn:bad extension:../deps/openssl/openssl/ssl/statem/extensions_clnt.c:1713:";
    expect(shouldFallbackFromHttp2(msg)).toBe(true);
  });

  it("matches TLS alert 120 no application protocol", () => {
    const msg =
      "58B221FBF97F0000:error:0A000460:SSL routines:ssl3_read_bytes:tlsv1 alert no application protocol:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:918:SSL alert number 120";
    expect(shouldFallbackFromHttp2(msg)).toBe(true);
  });

  it("matches uppercase ALPN and nghttp2 protocol errors", () => {
    expect(shouldFallbackFromHttp2("ALPN protocol mismatch")).toBe(true);
    expect(shouldFallbackFromHttp2("NGHTTP2_PROTOCOL_ERROR")).toBe(true);
    expect(shouldFallbackFromHttp2("ERR_HTTP2_SESSION_ERROR")).toBe(true);
  });

  it("does not treat a generic 401 API error as a protocol fallback", () => {
    expect(shouldFallbackFromHttp2("Invalid API key")).toBe(false);
    expect(shouldFallbackFromHttp2("HTTP 404")).toBe(false);
  });
});
