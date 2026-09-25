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
        className="h-8 gap-2 rounded-sm px-3 text-mini"
      >
        <span>{selectedRange.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition ${isOpen ? 'rotate-180' : ''}`} />
      </Button>
    </PopoverTrigger>

    <PopoverContent align="end" className="w-48 p-2">
      <div className="space-y-1">
        {presets.map((range) => (
          <button
            key={range.hours}
            type="button"
            className={`w-full rounded-sm px-2 py-1.5 text-left text-mini font-medium transition-colors ${
              selectedRange.label === range.label
                ? 'bg-primary-muted text-primary'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
            }`}
            onClick={() => handlePresetClick(range)}
          >
            {range.label}
          </button>
        ))}
        <div className="border-t border-border pt-2">
          <div className="type-overline px-3 py-2">
            {t('timeRange.customRange')}
          </div>
          <div className="space-y-2 px-3 pb-2">
            <div>
              <label className="type-overline">{t('timeRange.hours')}</label>
              <Input
                type="number"
                min="1"
                max="8760"
                value={customHours}
                onChange={(e) => setCustomHours(e.target.value)}
                placeholder="24"
                className="mt-1 h-7 rounded-sm text-mini"
              />
            </div>
            <div>
              <label className="type-overline">{t('timeRange.dataPoints')}</label>
              <Input
                type="number"
                min="1"
                max="1000"
                value={customLimit}
                onChange={(e) => setCustomLimit(e.target.value)}
                placeholder="144"
                className="mt-1 h-7 rounded-sm text-mini"
              />
            </div>
            <Button
              size="sm"
              onClick={handleCustomSubmit}
              disabled={!customHours || !customLimit}
              className="h-7 w-full rounded-sm px-3 text-mini"
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
