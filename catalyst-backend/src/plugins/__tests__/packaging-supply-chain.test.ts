/**
 * Supply-chain hardening regression tests for plugin package downloads.
 *
 * Pins the B3-4/P2-4 fixes:
 *  - `downloadPackage` follows redirects MANUALLY, re-validating every hop
 *    against the https-only + SSRF allowlist, so a first-hop public host
 *    cannot re-point the fetch at a private/metadata address.
 *  - Legitimate redirects still work (GitHub Releases / S3 presigned URLs),
 *    which `redirect: 'error'` would have broken.
 *  - `POST /api/plugins/install` requires a pinned 64-hex sha256; an
 *    unverified package is refused with 400 VALIDATION_ERROR before any
 *    download is attempted.
 */
import 'dotenv/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { pluginRoutes } from '../../routes/plugins.js';
import { downloadPackage, isPrivateIp, type PackageFetch } from '../marketplace/packaging';

// ── SSRF guard: address-form coverage ───────────────────────────────────────

describe('isPrivateIp — every encoding of a private target is refused (R1)', () => {
  const PRIVATE = [
    // IPv4
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1',
    // IPv6 loopback / unspecified / ULA / link-local
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'fec0::1', 'ff02::1',
    // IPv4-mapped (the form that bypassed the old prefix check)
    '::ffff:169.254.169.254',
    '::ffff:127.0.0.1',
    '::ffff:10.1.2.3',
    '::ffff:192.168.0.1',
    '0:0:0:0:0:ffff:169.254.169.254',
    // IPv4-compatible (deprecated)
    '::127.0.0.1',
    '::169.254.169.254',
    // 6to4 embedding a private IPv4
    '2002:7f00:1::',
    '2002:a9fe:a9fe::',
    // NAT64 embedding a private IPv4
    '64:ff9b::127.0.0.1',
    '64:ff9b::a9fe:a9fe',
    // Expanded loopback
    '0:0:0:0:0:0:0:1',
    // Zone id
    'fe80::1%eth0',
    // Unparseable → unsafe
    'not-an-ip', '',
  ];

  const PUBLIC = [
    '1.1.1.1', '8.8.8.8', '93.184.216.34',
    '2606:4700:4700::1111', '2001:4860:4860::8888',
    '::ffff:1.1.1.1', // IPv4-mapped but public
    '2002:0808:0808::', // 6to4 embedding 8.8.8.8
  ];

  for (const ip of PRIVATE) {
    it(`refuses ${JSON.stringify(ip)}`, () => {
      expect(isPrivateIp(ip)).toBe(true);
    });
  }
  for (const ip of PUBLIC) {
    it(`allows ${JSON.stringify(ip)}`, () => {
      expect(isPrivateIp(ip)).toBe(false);
    });
  }
});

// ── downloadPackage: redirect handling ──────────────────────────────────────

describe('downloadPackage — redirects are re-validated per hop (B3-4)', () => {
  it('refuses a redirect to a link-local/metadata address and never fetches it', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: any) => {
      calls.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { location: 'https://169.254.169.254/latest/meta-data/iam' },
      });
    }) as PackageFetch;

    await expect(
      downloadPackage('https://1.1.1.1/pkg.zip', { allowLocal: false, timeoutMs: 5000, fetchImpl }),
    ).rejects.toThrow(/private address|local\/private hosts/);

    // Only the validated first hop was fetched; the metadata target never was.
    expect(calls).toEqual(['https://1.1.1.1/pkg.zip']);
  });

  it('refuses a redirect that downgrades to plaintext http', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: any) => {
      calls.push(String(input));
      return new Response(null, {
        status: 301,
        headers: { location: 'http://1.1.1.1/pkg.zip' },
      });
    }) as PackageFetch;

    await expect(
      downloadPackage('https://1.1.1.1/pkg.zip', { allowLocal: false, timeoutMs: 5000, fetchImpl }),
    ).rejects.toThrow(/https/);
    expect(calls).toHaveLength(1);
  });

  it('follows a redirect to another allowed host', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: any) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://1.1.1.1/real.zip' } });
      }
      return new Response(Buffer.from('zip-bytes'), {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      });
    }) as PackageFetch;

    const result = await downloadPackage('https://1.1.1.1/pkg.zip', {
      allowLocal: false,
      timeoutMs: 5000,
      fetchImpl,
    });
    expect(calls).toEqual(['https://1.1.1.1/pkg.zip', 'https://1.1.1.1/real.zip']);
    expect(result.bytes).toBe(Buffer.byteLength('zip-bytes'));
  });

  it('follows a relative Location', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: any) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: '/real.zip' } });
      }
      return new Response(Buffer.from('zip'), { status: 200 });
    }) as PackageFetch;

    const result = await downloadPackage('https://1.1.1.1/a/pkg.zip', {
      allowLocal: false,
      timeoutMs: 5000,
      fetchImpl,
    });
    expect(calls).toEqual(['https://1.1.1.1/a/pkg.zip', 'https://1.1.1.1/real.zip']);
    expect(result.bytes).toBe(3);
  });

  it('refuses a redirect chain that exceeds maxHops', async () => {
    let hops = 0;
    const fetchImpl = (async () => {
      hops++;
      return new Response(null, { status: 302, headers: { location: 'https://1.1.1.1/again.zip' } });
    }) as PackageFetch;
    await expect(
      downloadPackage('https://1.1.1.1/pkg.zip', { allowLocal: false, timeoutMs: 5000, fetchImpl }),
    ).rejects.toThrow(/redirects/);
    expect(hops).toBe(6); // maxHops=5 permits the initial fetch plus 5 redirects
  });

  it('rejects a valid-looking sha256 that does not match the bytes', async () => {
    const fetchImpl = (async () => new Response(Buffer.from('actual-bytes'), { status: 200 })) as PackageFetch;
    await expect(
      downloadPackage('https://1.1.1.1/pkg.zip', {
        allowLocal: false,
        timeoutMs: 5000,
        fetchImpl,
        expectedSha256: 'a'.repeat(64),
      }),
    ).rejects.toThrow(/checksum does not match/i);
  });
});

// ── install route: checksum required ────────────────────────────────────────

const pluginLoader = {
  getPluginsDir: () => '/tmp/catpkg-supply-chain-plugins',
  discoverSingle: async () => {},
  getRegistry: () => ({ getAll: () => [], get: () => null }),
} as any;

const prisma = {
  plugin: { findMany: async () => [], findUnique: async () => null },
  pluginActionAudit: { create: async () => ({}) },
} as any;

let app: any;

async function buildApp() {
  const instance = Fastify({ logger: false });
  instance.decorate('authenticate', async (request: any) => {
    request.user = { id: 'admin', permissions: ['admin.write'] };
  });
  await pluginRoutes(instance as any, pluginLoader, prisma);
  await instance.ready();
  return instance;
}

beforeEach(async () => {
  app = await buildApp();
});

afterEach(async () => {
  await app?.close();
});

describe('POST /api/plugins/install — unverified package refused (P2-4)', () => {
  it('returns 400 VALIDATION_ERROR when sha256 is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/plugins/install',
      payload: { url: 'https://example.com/demo-plugin-1.0.0.catpkg.zip' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('still rejects a malformed (non-64-hex) sha256 with 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/plugins/install',
      payload: { url: 'https://example.com/demo-plugin-1.0.0.catpkg.zip', sha256: 'not-a-hash' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});
