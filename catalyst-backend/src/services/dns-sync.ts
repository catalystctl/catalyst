import { prisma } from '../db.js';

export interface DnsRecordResult {
  success: boolean;
  recordId?: string;
  error?: string;
}

export const getDnsSettings = async () => {
  return prisma.systemSetting.findUnique({ where: { id: 'dns' } });
};

interface CloudflareApiError {
  message: string;
}

interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
}

interface CloudflareResponse<T> {
  success?: boolean;
  errors?: CloudflareApiError[];
  result?: T;
}

const CF_API_BASE = 'https://api.cloudflare.com/client/v4/zones';

const cfHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

const listRecords = async (
  zoneId: string,
  token: string,
  name: string,
  type: string
): Promise<CloudflareDnsRecord[]> => {
  const res = await fetch(
    `${CF_API_BASE}/${zoneId}/dns_records?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: cfHeaders(token) }
  );
  const data = (await res.json()) as CloudflareResponse<CloudflareDnsRecord[]>;
  return data.result ?? [];
};

const upsertRecord = async (
  zoneId: string,
  token: string,
  type: string,
  name: string,
  body: object
): Promise<DnsRecordResult> => {
  const existing = await listRecords(zoneId, token, name, type);
  const record = existing[0];

  const payload = JSON.stringify(body);

  if (record?.id) {
    const updateRes = await fetch(`${CF_API_BASE}/${zoneId}/dns_records/${record.id}`, {
      method: 'PUT',
      headers: cfHeaders(token),
      body: payload,
    });
    const updateData = (await updateRes.json()) as CloudflareResponse<CloudflareDnsRecord>;
    if (!updateData.success) {
      return {
        success: false,
        error: updateData.errors?.[0]?.message || `${type} record update failed`,
      };
    }
    return { success: true, recordId: updateData.result?.id };
  }

  const createRes = await fetch(`${CF_API_BASE}/${zoneId}/dns_records`, {
    method: 'POST',
    headers: cfHeaders(token),
    body: payload,
  });
  const createData = (await createRes.json()) as CloudflareResponse<CloudflareDnsRecord>;
  if (!createData.success) {
    return {
      success: false,
      error: createData.errors?.[0]?.message || `${type} record create failed`,
    };
  }
  return { success: true, recordId: createData.result?.id };
};

const deleteRecord = async (
  zoneId: string,
  token: string,
  name: string,
  type: string
): Promise<void> => {
  const existing = await listRecords(zoneId, token, name, type);
  const record = existing[0];
  if (record?.id) {
    await fetch(`${CF_API_BASE}/${zoneId}/dns_records/${record.id}`, {
      method: 'DELETE',
      headers: cfHeaders(token),
    });
  }
};

export const syncServerSubdomain = async (
  server: {
    id: string;
    subdomain: string | null;
    primaryIp: string | null;
    primaryPort: number;
    template?: { srvService?: string | null; srvProtocol?: string } | null;
  }
): Promise<DnsRecordResult> => {
  const settings = await getDnsSettings();
  if (!settings?.dnsEnabled || !settings.dnsProvider || !server.subdomain || !server.primaryIp) {
    return { success: true }; // Nothing to do
  }
  if (settings.dnsProvider !== 'cloudflare') {
    return { success: false, error: `Unsupported DNS provider: ${settings.dnsProvider}` };
  }
  if (!settings.dnsCloudflareApiToken || !settings.dnsCloudflareZoneId || !settings.dnsBaseDomain) {
    return { success: false, error: 'Cloudflare credentials or base domain not configured' };
  }

  const fqdn = `${server.subdomain}.${settings.dnsBaseDomain}`;

  // 1. Upsert A record (IP address) — always needed
  const aResult = await upsertRecord(
    settings.dnsCloudflareZoneId,
    settings.dnsCloudflareApiToken,
    'A',
    server.subdomain,
    {
      type: 'A',
      name: server.subdomain,
      content: server.primaryIp,
      ttl: 120,
      proxied: false,
    }
  );
  if (!aResult.success) return aResult;

  // 2. Upsert SRV record only if template has srvService set
  const srvService = server.template?.srvService;
  if (srvService) {
    const srvProtocol = server.template?.srvProtocol ?? 'tcp';
    const srvName = `_${srvService}._${srvProtocol}.${server.subdomain}`;
    const srvResult = await upsertRecord(
      settings.dnsCloudflareZoneId,
      settings.dnsCloudflareApiToken,
      'SRV',
      srvName,
      {
        type: 'SRV',
        name: srvName,
        data: {
          priority: 0,
          weight: 0,
          port: server.primaryPort,
          target: fqdn,
        },
        ttl: 120,
      }
    );
    if (!srvResult.success) return srvResult;
  }

  return { success: true };
};

export const deleteServerSubdomain = async (
  server: {
    subdomain: string | null;
    primaryPort: number;
    template?: { srvService?: string | null; srvProtocol?: string } | null;
  }
): Promise<DnsRecordResult> => {
  const settings = await getDnsSettings();
  if (!settings?.dnsEnabled || !server.subdomain || settings.dnsProvider !== 'cloudflare') {
    return { success: true };
  }
  if (!settings.dnsCloudflareApiToken || !settings.dnsCloudflareZoneId) {
    return { success: true };
  }

  const deletions: Promise<void>[] = [
    deleteRecord(settings.dnsCloudflareZoneId, settings.dnsCloudflareApiToken, server.subdomain, 'A'),
  ];

  const srvService = server.template?.srvService;
  if (srvService) {
    const srvProtocol = server.template?.srvProtocol ?? 'tcp';
    const srvName = `_${srvService}._${srvProtocol}.${server.subdomain}`;
    deletions.push(deleteRecord(settings.dnsCloudflareZoneId, settings.dnsCloudflareApiToken, srvName, 'SRV'));
  }

  await Promise.all(deletions);
  return { success: true };
};
