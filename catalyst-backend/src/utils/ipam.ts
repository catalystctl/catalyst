import type { Prisma, PrismaClient } from "@prisma/client";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

type IpFamily = 'v4' | 'v6';

type PoolRange = {
  start: number | bigint;
  end: number | bigint;
  family: IpFamily;
};

export const isIpv6 = (value: string): boolean => value.includes(':');

const parseIpv4 = (value: string): number => {
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${value}`);
  }
  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    (parts[3] >>> 0)
  );
};

export const toIpv4 = (value: number): string =>
  [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");

const parseIpv6 = (value: string): bigint => {
  let expanded = value;
  if (expanded.includes("::")) {
    const [left, right] = expanded.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    const missing = 8 - leftParts.length - rightParts.length;
    if (missing < 0) {
      throw new Error(`Invalid IPv6 address: ${value}`);
    }
    const middle = Array(missing).fill("0");
    expanded = [...leftParts, ...middle, ...rightParts].join(":");
  } else {
    const parts = expanded.split(":");
    if (parts.length !== 8) {
      throw new Error(`Invalid IPv6 address: ${value}`);
    }
  }

  const parts = expanded.split(":");
  if (parts.length !== 8) {
    throw new Error(`Invalid IPv6 address: ${value}`);
  }

  let result = 0n;
  for (const part of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) {
      throw new Error(`Invalid IPv6 address: ${value}`);
    }
    result = (result << 16n) | BigInt(parseInt(part, 16));
  }
  return result;
};

export const formatIpv6 = (value: bigint): string => {
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const shift = BigInt(7 - i) * 16n;
    const part = Number((value >> shift) & 0xffffn);
    parts.push(part.toString(16));
  }

  // Find longest run of zeros
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < 8; i++) {
    if (parts[i] === "0") {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen >= 2) {
    const before = parts.slice(0, bestStart).join(":");
    const after = parts.slice(bestStart + bestLen).join(":");
    if (!before && !after) return "::";
    if (!before) return "::" + after;
    if (!after) return before + "::";
    return before + "::" + after;
  }

  return parts.join(":");
};

export const parseIp = (value: string): { value: number | bigint; family: IpFamily } => {
  if (isIpv6(value)) {
    return { value: parseIpv6(value), family: 'v6' };
  }
  return { value: parseIpv4(value), family: 'v4' };
};

export const formatIp = (value: number | bigint, family: IpFamily): string => {
  if (family === 'v6') {
    return formatIpv6(value as bigint);
  }
  return toIpv4(value as number);
};

const parseIpv4Cidr = (cidr: string): PoolRange => {
  const [ip, prefixRaw] = cidr.split("/");
  if (!ip || prefixRaw === undefined) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }
  const prefix = Number(prefixRaw);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR prefix: ${cidr}`);
  }

  const ipInt = parseIpv4(ip);
  const mask = prefix === 0 ? 0 : ((~0 << (32 - prefix)) >>> 0);
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  if (prefix >= 31) {
    return { start: network, end: broadcast, family: 'v4' };
  }

  return { start: network + 1, end: broadcast - 1, family: 'v4' };
};

const parseIpv6Cidr = (cidr: string): PoolRange => {
  const [ip, prefixRaw] = cidr.split("/");
  if (!ip || prefixRaw === undefined) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }
  const prefix = Number(prefixRaw);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 128) {
    throw new Error(`Invalid IPv6 CIDR prefix: ${cidr}`);
  }

  const ipInt = parseIpv6(ip);
  const hostBits = 128 - prefix;
  const mask = prefix === 0
    ? 0n
    : ((1n << BigInt(hostBits)) - 1n) ^ ((1n << 128n) - 1n);
  const network = ipInt & mask;
  const broadcast = network | ((1n << BigInt(hostBits)) - 1n);

  if (prefix >= 127) {
    return { start: network, end: broadcast, family: 'v6' };
  }

  return { start: network + 1n, end: broadcast - 1n, family: 'v6' };
};

export const parseCidr = (cidr: string): PoolRange => {
  const [ip] = cidr.split("/");
  if (!ip) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }
  if (isIpv6(ip)) {
    return parseIpv6Cidr(cidr);
  }
  return parseIpv4Cidr(cidr);
};

const getPoolRange = (pool: {
  cidr: string;
  startIp?: string | null;
  endIp?: string | null;
}): PoolRange => {
  const baseRange = parseCidr(pool.cidr);
  const start = pool.startIp ? parseIp(pool.startIp).value : baseRange.start;
  const end = pool.endIp ? parseIp(pool.endIp).value : baseRange.end;

  const startGreaterThanEnd =
    typeof start === 'bigint' && typeof end === 'bigint'
      ? start > end
      : typeof start === 'number' && typeof end === 'number'
      ? start > end
      : true;

  if (startGreaterThanEnd) {
    throw new Error("IP range start must be <= end");
  }

  const outOfRange =
    typeof start === 'bigint' && typeof end === 'bigint' && typeof baseRange.start === 'bigint' && typeof baseRange.end === 'bigint'
      ? start < baseRange.start || end > baseRange.end
      : typeof start === 'number' && typeof end === 'number' && typeof baseRange.start === 'number' && typeof baseRange.end === 'number'
      ? start < baseRange.start || end > baseRange.end
      : true;

  if (outOfRange) {
    throw new Error("IP range must be within CIDR block");
  }

  return { start, end, family: baseRange.family };
};

const getReservedIps = (pool: { reserved?: Prisma.JsonValue; gateway?: string | null }) => {
  const reserved = new Set<string>();
  if (Array.isArray(pool.reserved)) {
    for (const value of pool.reserved) {
      if (typeof value === "string" && value.length > 0) {
        reserved.add(value);
      }
    }
  }
  if (pool.gateway) {
    reserved.add(pool.gateway);
  }
  return reserved;
};

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;

const isIpv6LinkLocal = (value: bigint): boolean => (value >> 118n) === 0x3fan;
const isIpv6UniqueLocal = (value: bigint): boolean => (value >> 121n) === 0x7en;

export const normalizeHostIp = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (isIpv6(trimmed)) {
    const ip = parseIpv6(trimmed);
    if (ip === 0n) {
      throw new Error("Host IP must not be an IPv6 unspecified address");
    }
    if (isIpv6LinkLocal(ip)) {
      throw new Error("Host IP must not be an IPv6 link-local address");
    }
    if (isIpv6UniqueLocal(ip)) {
      throw new Error("Host IP must not be an IPv6 unique-local address");
    }
    return trimmed;
  }

  if (!IPV4_REGEX.test(trimmed)) {
    throw new Error("Host IP must be a valid IPv4 or IPv6 address");
  }
  if (trimmed.startsWith("127.")) {
    throw new Error("Host IP must be a non-loopback IPv4 address");
  }
  return trimmed;
};

export const shouldUseIpam = (networkMode?: string) => {
  if (!networkMode) return false;
  return networkMode !== "bridge" && networkMode !== "host";
};

export const allocateIpForServer = async (
  prisma: PrismaLike,
  {
    nodeId,
    networkName,
    serverId,
    requestedIp,
  }: {
    nodeId: string;
    networkName: string;
    serverId: string;
    requestedIp?: string | null;
  }
): Promise<string | null> => {
  const pool = await prisma.ipPool.findUnique({
    where: {
      nodeId_networkName: {
        nodeId,
        networkName,
      },
    },
    include: {
      allocations: {
        where: { releasedAt: null },
      },
    },
  });

  if (!pool) {
    return null;
  }

  const reserved = getReservedIps(pool);
  const range = getPoolRange(pool);
  const used = new Set(pool.allocations.map((allocation) => allocation.ip));

  if (requestedIp) {
    const parsed = parseIp(requestedIp);
    if (parsed.family !== range.family) {
      throw new Error("Requested IP family does not match pool family");
    }
    const ipValue = parsed.value;

    const inRange =
      range.family === 'v6' && typeof ipValue === 'bigint' && typeof range.start === 'bigint' && typeof range.end === 'bigint'
        ? ipValue >= range.start && ipValue <= range.end
        : range.family === 'v4' && typeof ipValue === 'number' && typeof range.start === 'number' && typeof range.end === 'number'
        ? ipValue >= range.start && ipValue <= range.end
        : false;

    if (!inRange) {
      throw new Error("Requested IP is outside of the pool range");
    }
    if (reserved.has(requestedIp)) {
      throw new Error("Requested IP is reserved");
    }
    if (used.has(requestedIp)) {
      throw new Error("Requested IP is already allocated");
    }

    await prisma.ipAllocation.create({
      data: {
        poolId: pool.id,
        serverId,
        ip: requestedIp,
      },
    });

    return requestedIp;
  }

  if (range.family === 'v6') {
    let value = range.start as bigint;
    const end = range.end as bigint;
    while (value <= end) {
      const ip = formatIpv6(value);
      if (!reserved.has(ip) && !used.has(ip)) {
        await prisma.ipAllocation.create({
          data: {
            poolId: pool.id,
            serverId,
            ip,
          },
        });
        return ip;
      }
      value += 1n;
    }
  } else {
    for (let value = range.start as number; value <= (range.end as number); value += 1) {
      const ip = toIpv4(value >>> 0);
      if (reserved.has(ip) || used.has(ip)) {
        continue;
      }

      await prisma.ipAllocation.create({
        data: {
          poolId: pool.id,
          serverId,
          ip,
        },
      });

      return ip;
    }
  }

  throw new Error("No available IPs in pool");
};

export const releaseIpForServer = async (
  prisma: PrismaLike,
  serverId: string
) => {
  const allocation = await prisma.ipAllocation.findFirst({
    where: {
      serverId,
      releasedAt: null,
    },
  });

  if (!allocation) {
    return null;
  }

  await prisma.ipAllocation.update({
    where: { id: allocation.id },
    data: { releasedAt: new Date() },
  });

  return allocation.ip;
};

export const summarizePool = (pool: {
  cidr: string;
  startIp?: string | null;
  endIp?: string | null;
  gateway?: string | null;
  reserved?: Prisma.JsonValue;
}) => {
  const range = getPoolRange(pool);
  const reserved = getReservedIps(pool);

  let total: number;
  if (range.family === 'v6') {
    const size = (range.end as bigint) - (range.start as bigint) + 1n;
    total = size > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(size);
  } else {
    total = (range.end as number) - (range.start as number) + 1;
  }

  let reservedCount = 0;
  reserved.forEach((ip) => {
    try {
      const parsed = parseIp(ip);
      if (parsed.family !== range.family) return;
      const ipValue = parsed.value;
      const inRange =
        range.family === 'v6' && typeof ipValue === 'bigint' && typeof range.start === 'bigint' && typeof range.end === 'bigint'
          ? ipValue >= range.start && ipValue <= range.end
          : range.family === 'v4' && typeof ipValue === 'number' && typeof range.start === 'number' && typeof range.end === 'number'
          ? ipValue >= range.start && ipValue <= range.end
          : false;
      if (inRange) {
        reservedCount += 1;
      }
    } catch {
      // ignore invalid reserved IPs
    }
  });

  return {
    rangeStart: formatIp(range.start, range.family),
    rangeEnd: formatIp(range.end, range.family),
    total,
    reserved: Array.from(reserved),
    reservedCount,
  };
};

export const listAvailableIps = async (
  prisma: PrismaLike,
  {
    nodeId,
    networkName,
    limit = 200,
  }: {
    nodeId: string;
    networkName: string;
    limit?: number;
  }
) => {
  const pool = await prisma.ipPool.findUnique({
    where: {
      nodeId_networkName: {
        nodeId,
        networkName,
      },
    },
    include: {
      allocations: {
        where: { releasedAt: null },
        select: { ip: true },
      },
    },
  });

  if (!pool) {
    return null;
  }

  const reserved = getReservedIps(pool);
  const range = getPoolRange(pool);
  const used = new Set(pool.allocations.map((allocation) => allocation.ip));
  const available: string[] = [];

  if (range.family === 'v6') {
    let value = range.start as bigint;
    const end = range.end as bigint;
    while (value <= end) {
      const ip = formatIpv6(value);
      if (!reserved.has(ip) && !used.has(ip)) {
        available.push(ip);
      }
      if (available.length >= limit) break;
      value += 1n;
    }
  } else {
    for (let value = range.start as number; value <= (range.end as number); value += 1) {
      const ip = toIpv4(value >>> 0);
      if (reserved.has(ip) || used.has(ip)) {
        continue;
      }
      available.push(ip);
      if (available.length >= limit) break;
    }
  }

  return available;
};
