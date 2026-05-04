import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch before any module imports
const fetchMock = vi.fn();
global.fetch = fetchMock;

// Mock db.js with a self-contained factory (no external refs)
vi.mock('../db.js', () => ({
  prisma: {
    systemSetting: {
      findUnique: vi.fn(),
    },
  },
}));

// Now import dns-sync after mocks are registered
import { syncServerSubdomain, deleteServerSubdomain } from '../services/dns-sync.js';
import { prisma } from '../db.js';

const findUniqueMock = prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>;

describe('Subdomain Support', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Validation', () => {
    it('accepts valid subdomains', () => {
      const valid = ['abc', 'abc-123', 'my-server', 'a1'];
      const regex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
      for (const s of valid) {
        expect(regex.test(s)).toBe(true);
      }
    });

    it('rejects invalid subdomains', () => {
      const invalid = ['-abc', 'abc_', 'Abc', 'a..b', 'abc.', '.abc', 'a_b'];
      const regex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
      for (const s of invalid) {
        expect(regex.test(s)).toBe(false);
      }
    });
  });

  describe('DNS Sync Service', () => {
    it('returns success when DNS is disabled', async () => {
      findUniqueMock.mockResolvedValue({
        dnsEnabled: false,
      });

      const result = await syncServerSubdomain({
        id: 'srv1',
        subdomain: 'test',
        primaryIp: '192.168.1.1',
        primaryPort: 25565,
        template: null,
      });

      expect(result.success).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('creates A record only when template has no srvService', async () => {
      findUniqueMock.mockResolvedValue({
        dnsEnabled: true,
        dnsProvider: 'cloudflare',
        dnsBaseDomain: 'example.com',
        dnsCloudflareApiToken: 'token',
        dnsCloudflareZoneId: 'zone123',
      });

      fetchMock
        .mockResolvedValueOnce({
          json: async () => ({ success: true, result: [] }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ success: true, result: { id: 'rec-a' } }),
        });

      const result = await syncServerSubdomain({
        id: 'srv1',
        subdomain: 'test',
        primaryIp: '192.168.1.1',
        primaryPort: 25565,
        template: null,
      });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2); // list A + create A

      const aCall = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(aCall.type).toBe('A');
      expect(aCall.content).toBe('192.168.1.1');
    });

    it('creates A and SRV records when template has srvService', async () => {
      findUniqueMock.mockResolvedValue({
        dnsEnabled: true,
        dnsProvider: 'cloudflare',
        dnsBaseDomain: 'example.com',
        dnsCloudflareApiToken: 'token',
        dnsCloudflareZoneId: 'zone123',
      });

      // 4 fetch calls: list A, create A, list SRV, create SRV
      fetchMock
        .mockResolvedValueOnce({
          json: async () => ({ success: true, result: [] }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ success: true, result: { id: 'rec-a' } }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ success: true, result: [] }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ success: true, result: { id: 'rec-srv' } }),
        });

      const result = await syncServerSubdomain({
        id: 'srv1',
        subdomain: 'test',
        primaryIp: '192.168.1.1',
        primaryPort: 25565,
        template: { srvService: 'minecraft', srvProtocol: 'tcp' },
      });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(4);

      const aCall = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(aCall.type).toBe('A');

      const srvCall = JSON.parse(fetchMock.mock.calls[3][1].body);
      expect(srvCall.type).toBe('SRV');
      expect(srvCall.data.port).toBe(25565);
      expect(srvCall.data.target).toBe('test.example.com');
      expect(srvCall.name).toBe('_minecraft._tcp.test');
    });

    it('updates existing A and SRV records', async () => {
      findUniqueMock.mockResolvedValue({
        dnsEnabled: true,
        dnsProvider: 'cloudflare',
        dnsBaseDomain: 'example.com',
        dnsCloudflareApiToken: 'token',
        dnsCloudflareZoneId: 'zone123',
      });

      fetchMock
        .mockResolvedValueOnce({
          json: async () => ({ success: true, result: [{ id: 'rec-a' }] }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ success: true, result: { id: 'rec-a' } }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ success: true, result: [{ id: 'rec-srv' }] }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ success: true, result: { id: 'rec-srv' } }),
        });

      const result = await syncServerSubdomain({
        id: 'srv1',
        subdomain: 'test',
        primaryIp: '192.168.1.2',
        primaryPort: 25566,
        template: { srvService: 'minecraft', srvProtocol: 'tcp' },
      });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('deletes A and SRV records when template has srvService', async () => {
      findUniqueMock.mockResolvedValue({
        dnsEnabled: true,
        dnsProvider: 'cloudflare',
        dnsBaseDomain: 'example.com',
        dnsCloudflareApiToken: 'token',
        dnsCloudflareZoneId: 'zone123',
      });

      fetchMock.mockResolvedValue({
        json: async () => ({ success: true, result: [{ id: 'rec1' }] }),
      });

      const result = await deleteServerSubdomain({
        subdomain: 'test',
        primaryPort: 25565,
        template: { srvService: 'minecraft', srvProtocol: 'tcp' },
      });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(4); // 2 list + 2 delete
    });

    it('deletes only A record when template has no srvService', async () => {
      findUniqueMock.mockResolvedValue({
        dnsEnabled: true,
        dnsProvider: 'cloudflare',
        dnsBaseDomain: 'example.com',
        dnsCloudflareApiToken: 'token',
        dnsCloudflareZoneId: 'zone123',
      });

      fetchMock.mockResolvedValue({
        json: async () => ({ success: true, result: [{ id: 'rec1' }] }),
      });

      const result = await deleteServerSubdomain({
        subdomain: 'test',
        primaryPort: 25565,
        template: null,
      });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2); // 1 list + 1 delete
    });

    it('returns error for unsupported provider', async () => {
      findUniqueMock.mockResolvedValue({
        dnsEnabled: true,
        dnsProvider: 'route53',
        dnsBaseDomain: 'example.com',
      });

      const result = await syncServerSubdomain({
        id: 'srv1',
        subdomain: 'test',
        primaryIp: '192.168.1.1',
        primaryPort: 25565,
        template: null,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported DNS provider');
    });
  });
});
