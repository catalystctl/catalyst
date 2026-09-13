import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetricsTimeRange } from '../../hooks/useServerMetricsHistory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';

interface MetricsTimeRangeSelectorProps {
 selectedRange: MetricsTimeRange;
 onRangeChange: (range: MetricsTimeRange) => void;
}

function MetricsTimeRangeSelector({ selectedRange, onRangeChange }: MetricsTimeRangeSelectorProps) {
 const { t } = useTranslation('servers');
 const [isOpen, setIsOpen] = useState(false);
 const [customHours, setCustomHours] = useState('');
 const [customLimit, setCustomLimit] = useState('');

 // Preset captions are literal keys — never assembled dynamically.
 const presets = useMemo<MetricsTimeRange[]>(
 () => [
 { hours: 1, limit: 60, label: t('timeRange.presets.hour1') },
 { hours: 6, limit: 100, label: t('timeRange.presets.hours6') },
 { hours: 24, limit: 144, label: t('timeRange.presets.hours24') },
 { hours: 168, limit: 300, label: t('timeRange.presets.days7') },
 { hours: 720, limit: 500, label: t('timeRange.presets.days30') },
 ],
 [t],
 );

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
 alert(t('timeRange.hoursRangeError'));
 return;
 }

 if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) {
 alert(t('timeRange.limitRangeError'));
 return;
 }

 onRangeChange({
 hours,
 limit,
 label: t('timeRange.customLabel', { hours, limit }),
 });
 setIsOpen(false);
 setCustomHours('');
 setCustomLimit('');
 };

 // Portaled so the menu escapes the header card's overflow-hidden.
 return (
  <Popover open={isOpen} onOpenChange={setIsOpen}>
    <PopoverTrigger asChild>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
      >
        <span>{selectedRange.label}</span>
        <ChevronDown className={`h-4 w-4 transition ${isOpen ? 'rotate-180' : ''}`} />
      </Button>
    </PopoverTrigger>

    <PopoverContent align="end" className="w-48 p-2">
      <div className="space-y-1">
        {presets.map((range) => (
          <button
            key={range.hours}
            type="button"
            className={`w-full rounded-md px-3 py-2 text-left text-xs font-medium transition-all duration-300 ${
              selectedRange.label === range.label
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
            }`}
            onClick={() => handlePresetClick(range)}
          >
            {range.label}
          </button>
        ))}
        <div className="border-t border-border pt-2">
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('timeRange.customRange')}
          </div>
          <div className="space-y-2 px-3 pb-2">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('timeRange.hours')}</label>
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
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('timeRange.dataPoints')}</label>
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
              {t('common:actions.apply')}
            </Button>
          </div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
 );
}

export default MetricsTimeRangeSelector;
