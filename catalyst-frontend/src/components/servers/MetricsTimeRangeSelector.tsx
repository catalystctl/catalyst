import { useState } from 'react';
import type { MetricsTimeRange } from '../../hooks/useServerMetricsHistory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown } from 'lucide-react';

const PRESET_RANGES: MetricsTimeRange[] = [
  { hours: 1, limit: 60, label: '1 hour' },
  { hours: 6, limit: 100, label: '6 hours' },
  { hours: 24, limit: 144, label: '24 hours' },
  { hours: 168, limit: 300, label: '7 days' },
  { hours: 720, limit: 500, label: '30 days' },
];

interface MetricsTimeRangeSelectorProps {
  selectedRange: MetricsTimeRange;
  onRangeChange: (range: MetricsTimeRange) => void;
}

function MetricsTimeRangeSelector({ selectedRange, onRangeChange }: MetricsTimeRangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customHours, setCustomHours] = useState('');
  const [customLimit, setCustomLimit] = useState('');

  const handlePresetClick = (range: MetricsTimeRange) => {
    onRangeChange(range);
    setIsOpen(false);
    setCustomHours('');
    setCustomLimit('');
  };

  const handleCustomSubmit = () => {
    const hours = Number(customHours);
    const limit = Number(customLimit);

    if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) {
      alert('Hours must be between 1 and 8760 (1 year)');
      return;
    }

    if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) {
      alert('Limit must be between 1 and 1000 data points');
      return;
    }

    onRangeChange({
      hours,
      limit,
      label: `${hours}h (${limit} points)`,
    });
    setIsOpen(false);
    setCustomHours('');
    setCustomLimit('');
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="gap-2"
      >
        <span>{selectedRange.label}</span>
        <ChevronDown className={`h-4 w-4 transition ${isOpen ? 'rotate-180' : ''}`} />
      </Button>

      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-2 w-48 rounded-lg border border-border bg-card shadow-lg">
          <div className="space-y-1 p-2">
            {PRESET_RANGES.map((range) => (
              <button
                key={range.label}
                type="button"
                className={`w-full rounded-md px-3 py-2 text-left text-xs font-medium transition-all duration-300 ${
                  selectedRange.label === range.label
                    ? 'bg-primary text-primary-foreground shadow-lg'
                    : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
                }`}
                onClick={() => handlePresetClick(range)}
              >
                {range.label}
              </button>
            ))}
            <div className="border-t border-border pt-2">
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Custom range
              </div>
              <div className="space-y-2 px-3 pb-2">
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Hours</label>
                  <Input
                    type="number"
                    min="1"
                    max="8760"
                    value={customHours}
                    onChange={(e) => setCustomHours(e.target.value)}
                    placeholder="24"
                    className="mt-1 h-7 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Data points</label>
                  <Input
                    type="number"
                    min="1"
                    max="1000"
                    value={customLimit}
                    onChange={(e) => setCustomLimit(e.target.value)}
                    placeholder="144"
                    className="mt-1 h-7 text-xs"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleCustomSubmit}
                  disabled={!customHours || !customLimit}
                  className="w-full text-xs"
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MetricsTimeRangeSelector;
