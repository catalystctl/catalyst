import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Server, ServerMetrics as ServerMetricsType } from '../../../types/server';

/**
 * Minimal interpolation so assertions can read the rendered numbers, e.g.
 * `2.6 / 3 cores` and `87% of allocated cores`.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const templates: Record<string, string> = {
        'metrics.cpuAllocation': '{{used}} / {{total}} cores',
        'metrics.cpuPercentOfCores': '{{percent}}% of allocated cores',
        'metrics.labels.cpu': 'CPU',
        'metrics.labels.memory': 'Memory',
        'metrics.labels.ram': 'RAM',
        'metrics.labels.disk': 'Disk',
        'metrics.labels.network': 'Network',
        'metrics.resourceUsage': 'Resource usage',
        'metrics.live': 'Live',
        'metrics.offline': 'Offline',
      };
      const template = templates[key] ?? key;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name]))
        : template;
    },
  }),
}));

import ServerHeaderStats from '../ServerHeaderStats';
import ServerMetrics from '../ServerMetrics';
import ServerListItem from '../ServerListItem';
import ServerCard from '../ServerCard';

/**
 * The reported bug: on a 3-core server at 260% the gauge filled to the top
 * (100% width) although only ~87% of the allowance was in use.
 */
const THREE_CORE_CPU = 260;

const baseServer = {
  id: 's1',
  name: 'mc-3-core',
  status: 'running',
  nodeId: 'n1',
  templateId: 't1',
  primaryPort: 25565,
  primaryIp: '203.0.113.10',
  allocatedMemoryMb: 8192,
  memoryPercent: 40,
  memoryUsageMb: 2000,
  diskUsageMb: 4096,
  diskTotalMb: 20480,
  allocatedDiskMb: 20480,
  effectivePermissions: [],
  ownerId: 'u1',
} as unknown as Server;

const server: Server = {
  ...baseServer,
  cpuPercent: THREE_CORE_CPU,
  allocatedCpuCores: 3,
} as Server;

const metrics = {
  cpuPercent: THREE_CORE_CPU,
  memoryPercent: 40,
  memoryUsageMb: 2000,
  diskUsageMb: 4096,
  diskTotalMb: 20480,
  networkRxBytes: 0,
  networkTxBytes: 0,
} as unknown as ServerMetricsType;

/** Widths of every meter fill, in declaration order. */
function meterWidths(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('span[style*="width"]')).map(
    (el) => el.style.width,
  );
}

describe('CPU gauge on a 3-core server at 260%', () => {
  it('header fills to the share of the allocation, not to 100%', () => {
    const { container } = render(
      <ServerHeaderStats metrics={metrics} serverStatus="running" allocatedCpuCores={3} />,
    );
    // 260 / 3 = 86.67% of the allowance: visible headroom remains.
    expect(meterWidths(container)[0]).toBe('86.66666666666667%');
    // The reading names the cores in use...
    expect(screen.getAllByText('2.6 / 3 cores').length).toBeGreaterThan(0);
    // ...and the percentage of the allocation is still available on hover.
    expect(screen.getAllByTitle('87% of allocated cores').length).toBeGreaterThan(0);
    // The raw per-core number must never be shown unqualified again.
    expect(screen.queryByText('260%')).not.toBeInTheDocument();
  });

  it('metrics panel fills to the share of the allocation', () => {
    const { container } = render(
      <ServerMetrics cpu={THREE_CORE_CPU} memory={40} allocatedCpuCores={3} />,
    );
    expect(meterWidths(container)[0]).toBe('86.66666666666667%');
    expect(screen.getByText('2.6 / 3 cores')).toBeInTheDocument();
    expect(screen.getByTitle('87% of allocated cores')).toBeInTheDocument();
  });

  it('list row fills to the share and shows cores instead of a clamped 100%', () => {
    const { container } = render(
      <MemoryRouter>
        <ServerListItem server={server} />
      </MemoryRouter>,
    );
    expect(meterWidths(container)[0]).toBe('86.66666666666667%');
    expect(screen.getByText('2.6 / 3 cores')).toBeInTheDocument();
    // Regression: the old code clamped this reading to exactly "100%".
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('card fills to the share and shows cores instead of a clamped 100%', () => {
    const { container } = render(
      <MemoryRouter>
        <ServerCard server={server} />
      </MemoryRouter>,
    );
    expect(meterWidths(container)[0]).toBe('86.66666666666667%');
    expect(screen.getByText('2.6 / 3 cores')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });
});

describe('CPU gauge on a single-core server at 100%', () => {
  it('fills the bar and reads one full core', () => {
    const singleCore = { ...baseServer, cpuPercent: 100, allocatedCpuCores: 1 } as Server;
    const singleCoreMetrics = { ...metrics, cpuPercent: 100 } as unknown as ServerMetricsType;

    const header = render(
      <ServerHeaderStats
        metrics={singleCoreMetrics}
        serverStatus="running"
        allocatedCpuCores={1}
      />,
    );
    expect(meterWidths(header.container)[0]).toBe('100%');
    expect(screen.getAllByText('1 / 1 cores').length).toBeGreaterThan(0);
    header.unmount();

    const list = render(
      <MemoryRouter>
        <ServerListItem server={singleCore} />
      </MemoryRouter>,
    );
    // A single-core server at 100% is genuinely saturated: bar full.
    expect(meterWidths(list.container)[0]).toBe('100%');
  });
});

describe('CPU gauge without an allocation', () => {
  it('falls back to one core rather than dividing by zero', () => {
    const noAllocation = { ...baseServer, cpuPercent: 100 } as Server;
    const { container } = render(
      <MemoryRouter>
        <ServerListItem server={noAllocation} />
      </MemoryRouter>,
    );
    // 100% against an unknown allocation is one full core: bar full, no NaN.
    expect(meterWidths(container)[0]).toBe('100%');
    expect(screen.getByText('1 / 1 cores')).toBeInTheDocument();
  });

  it('leaves an idle server empty', () => {
    const idle = {
      ...baseServer,
      status: 'stopped',
      cpuPercent: 0,
      allocatedCpuCores: 3,
    } as Server;
    const { container } = render(
      <MemoryRouter>
        <ServerListItem server={idle} />
      </MemoryRouter>,
    );
    // Stopped servers keep the meters (they hold the row's shape) but every
    // fill is empty and no stale reading survives.
    expect(meterWidths(container)).toEqual(['0%', '0%', '0%']);
    expect(screen.queryByText(/cores/)).not.toBeInTheDocument();
  });
});
