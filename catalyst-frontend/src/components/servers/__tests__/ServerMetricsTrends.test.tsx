import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ServerMetricsPoint } from '../../../types/server';
import ServerMetricsTrends from '../ServerMetricsTrends';

vi.mock('recharts', () => ({
  // Keep the browser layout out of this unit test; retain the series given to it.
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
  LineChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) => (
    <div data-testid="chart" data-series={JSON.stringify(data)}>{children}</div>
  ),
  Line: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

describe('ServerMetricsTrends unavailable samples', () => {
  it('renders a CPU gap instead of inventing zero usage for an empty bucket', () => {
    const sample = {
      memoryUsageMb: 923,
      diskIoMb: 5,
      diskUsageMb: 2300,
      networkRxBytes: 0.1,
      networkTxBytes: 0.1,
      timestamp: '2026-11-04T12:00:00Z',
    };
    const history = [
      { ...sample, cpuPercent: 25 },
      { ...sample, cpuPercent: null, memoryUsageMb: null, diskIoMb: null, diskUsageMb: null, networkRxBytes: null, networkTxBytes: null },
      { ...sample, cpuPercent: 0 },
    ] satisfies ServerMetricsPoint[];

    const { container } = render(
      <ServerMetricsTrends history={history} latest={history[2]} allocatedCpuCores={4} />,
    );
    const chart = container.querySelector('[data-testid="chart"]');
    const series = JSON.parse(chart?.getAttribute('data-series') ?? '[]') as Array<{ value: number | null }>;
    expect(series.map((point) => point.value)).toEqual([6.25, null, 0]);
  });
});
