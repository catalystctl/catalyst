/**
 * Pterodactyl's `limits.threads` is CPU *pinning*, not a core count.
 *
 * The mapper used to read it with `parseInt`, so a pinned server exported as
 * `"threads": "0,2,4"` became `parseInt("0,2,4") || 1` = 1 core — the migrated
 * server lost both its pin and the allocation it paid for. These tests pin the
 * new mapping: the mask is carried as `cpuAffinity`, the cores come from
 * `limits.cpu`, and no stored row may violate the panel's own rule that a pin
 * must name at least as many CPUs as the allocation.
 */
import { describe, it, expect } from 'vitest';
import { EntityMapper } from '../services/migration/entity-mapper.js';
import type { PterodactylServer } from '../services/migration/types.js';

const baseServer: PterodactylServer = {
  id: 42,
  uuid: 'srv-uuid-42',
  name: 'Survival',
  identifier: 'abc123',
  suspended: false,
  node: 7,
  nest: 1,
  egg: 5,
  limits: { memory: 4096, swap: 0, disk: 10240, io: 500, cpu: 200 },
  feature_limits: { databases: 1, allocations: 3, backups: 2 },
  allocation: 11,
  allocations: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** The mapper's constructor only needs the Prisma client for other methods. */
const mapper = () => new EntityMapper({} as any);

function map(server: PterodactylServer) {
  const { data } = mapper().mapServer(server, 'tpl-1', 'node-1', 'owner-1', 'loc-1', {
    startup: 'echo hi',
    image: 'alpine:latest',
  });
  return data;
}

describe('Pterodactyl threads -> CPU pinning', () => {
  it('maps a pinned server to cpuAffinity and takes the cores from limits.cpu', () => {
    const data = map({ ...baseServer, limits: { ...baseServer.limits, cpu: 400, threads: '0,2,4' } });

    // 0, 2 and 4 are not contiguous: the canonical form keeps them separate.
    expect(data.cpuAffinity).toBe('0,2,4');
    // 400% = 4 cores, but only 3 CPUs are pinned, so the stored allocation is
    // clamped: a 4-core quota on 3 CPUs could never be spent.
    expect(data.allocatedCpuCores).toBe(3);
  });

  it('canonicalises ranges and a contiguous mask', () => {
    expect(map({ ...baseServer, limits: { ...baseServer.limits, cpu: 400, threads: '3,2' } }).cpuAffinity).toBe(
      '2-3',
    );
    expect(map({ ...baseServer, limits: { ...baseServer.limits, cpu: 200, threads: '4-5' } }).cpuAffinity).toBe(
      '4-5',
    );
  });

  it('falls back to the pin width when Pterodactyl reports no CPU percentage', () => {
    const data = map({ ...baseServer, limits: { ...baseServer.limits, cpu: 0, threads: '0,1,2' } });
    expect(data.cpuAffinity).toBe('0-2');
    expect(data.allocatedCpuCores).toBe(3);
  });

  it('treats Pterodactyl "0" (no pinning) as unpinned', () => {
    const data = map({ ...baseServer, limits: { ...baseServer.limits, cpu: 200, threads: '0' } });
    expect(data.cpuAffinity).toBeNull();
    expect(data.allocatedCpuCores).toBe(2);
  });

  it('leaves an unpinned server alone', () => {
    const data = map(baseServer);
    expect(data.cpuAffinity).toBeNull();
    expect(data.allocatedCpuCores).toBe(2);
  });

  it('keeps the historical core-count reading for a non-cpuset threads value', () => {
    // Exotic exports have put plain numbers in `threads`; those keep working.
    const data = map({ ...baseServer, limits: { ...baseServer.limits, cpu: 0, threads: '3' } });
    expect(data.cpuAffinity).toBe('3');
    expect(data.allocatedCpuCores).toBe(1);
  });
});
