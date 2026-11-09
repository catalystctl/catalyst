import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ServerMetricsPoint } from '../../../types/server';
import ServerMetricsTrends from '../ServerMetricsTrends';

vi.mock('recharts', () => ({
  // Keep the browser layout out of this unit test; retain the series given to it
  // and the axis scale each card asks for.
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
  LineChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) => (
    <div data-testid="chart" data-series={JSON.stringify(data)}>{children}</div>
  ),
  Line: () => null,
  YAxis: ({ domain }: { domain: [number, number | 'auto'] }) => (
    <div data-testid="y-axis" data-domain={JSON.stringify(domain)} />
  ),
  // Render what a hover would actually print, for a set of probe values.
  Tooltip: ({ formatter }: { formatter?: (value: number) => string }) => (
    <div
      data-testid="tooltip"
      data-samples={JSON.stringify(
        [0.05, 0.35, 0.1, 12, 65].map((value) => (formatter ? formatter(value) : null)),
      )}
    />
  ),
}));

const sample = {
  memoryUsageMb: 923,
  diskIoMb: 5,
  diskUsageMb: 2300,
  networkRxBytes: 0.1,
  networkTxBytes: 0.1,
  timestamp: '2026-11-04T12:00:00Z',
};

const renderTrends = (history: ServerMetricsPoint[], latest: ServerMetricsPoint | null) =>
  render(
    <ServerMetricsTrends
      history={history}
      latest={latest}
      allocatedMemoryMb={8192}
      allocatedCpuCores={4}
    />,
  );

/** The CPU card is first; the rest follow it in DOM order. */
const cpuTooltip = (container: HTMLElement) =>
  JSON.parse(
    container.querySelectorAll('[data-testid="tooltip"]')[0]?.getAttribute('data-samples') ?? '[]',
  ) as Array<string | null>;

describe('ServerMetricsTrends unavailable samples', () => {
  it('renders a CPU gap instead of inventing zero usage for an empty bucket', () => {
    const history = [
      { ...sample, cpuPercent: 25 },
      { ...sample, cpuPercent: null, memoryUsageMb: null, diskIoMb: null, diskUsageMb: null, networkRxBytes: null, networkTxBytes: null },
      { ...sample, cpuPercent: 0 },
    ] satisfies ServerMetricsPoint[];

    const { container } = renderTrends(history, history[2]);
    const chart = container.querySelector('[data-testid="chart"]');
    const series = JSON.parse(chart?.getAttribute('data-series') ?? '[]') as Array<{ value: number | null }>;
    expect(series.map((point) => point.value)).toEqual([6.25, null, 0]);
  });
});

describe('ServerMetricsTrends axis scale', () => {
  it('draws CPU against the whole allocation, not the window it happens to have', () => {
    // Auto-fitting the domain made a server jittering between 0.02% and 0.4%
    // of its CPU draw a full-height spike; the axis has to be the 0-100% the
    // card's own value is expressed in.
    const history = [0.02, 0.41, 0.12].map((cpuPercent) => ({ ...sample, cpuPercent }));
    const { container } = renderTrends(history, history[1]);
    const domain = container.querySelector('[data-testid="y-axis"]')?.getAttribute('data-domain');
    expect(JSON.parse(domain ?? 'null')).toEqual([0, 100]);
  });

  it('starts every card at zero so its height reads as a magnitude', () => {
    const history = [{ ...sample, cpuPercent: 20 }];
    const { container } = renderTrends(history, history[0]);
    const domains = [...container.querySelectorAll('[data-testid="y-axis"]')].map(
      (node) => JSON.parse(node.getAttribute('data-domain') ?? 'null') as [number, unknown],
    );
    expect(domains).toHaveLength(5);
    for (const [min] of domains) expect(min).toBe(0);
    // Memory is bounded by the allocation it can actually use.
    expect(domains[1][1]).toBe(8192);
  });
});

describe('ServerMetricsTrends CPU tooltip', () => {
  it('never reports a non-zero sample as zero', () => {
    // The report: "hovering the peak says 0 / 4 cores · 0% of allocated cores".
    const history = [{ ...sample, cpuPercent: 1.4 }];
    const { container } = renderTrends(history, history[0]);
    const [tiny, peak] = cpuTooltip(container);

    expect(peak).toBe('0.01 / 4 cores · 0.35% of allocated cores');
    expect(tiny).toBe('<0.01 / 4 cores · 0.05% of allocated cores');
  });

  it('keeps whole percentages where they are honest', () => {
    const history = [{ ...sample, cpuPercent: 260 }];
    const { container } = renderTrends(history, history[0]);
    const samples = cpuTooltip(container);
    // Probe values 12% and 65% of the allocation.
    expect(samples[3]).toBe('0.5 / 4 cores · 12% of allocated cores');
    expect(samples[4]).toBe('2.6 / 4 cores · 65% of allocated cores');
  });
});
