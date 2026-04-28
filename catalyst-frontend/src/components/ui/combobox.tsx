import { useMemo, useRef, useState } from 'react';
import type { ReactNode, KeyboardEvent } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type ComboboxOption = {
  value: string;
  label: ReactNode;
  keywords?: string[];
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
};

function Combobox({ value, onChange, options, placeholder = 'Select...', searchPlaceholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => {
      if (typeof o.label === 'string' && o.label.toLowerCase().includes(q)) return true;
      if (o.keywords?.some((kw) => kw.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [options, search]);

  const select = (optionValue: string) => {
    onChange(optionValue);
    setOpen(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSearch('');
      setFocusIdx(0);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[focusIdx]) select(filtered[focusIdx].value);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
    }
  };

  // Scroll focused item into view
  const itemRef = (idx: number) => {
    if (idx === focusIdx && listRef.current) {
      const el = listRef.current.children[focusIdx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground transition-all duration-200 hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
            className,
          )}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="z-50 w-[--radix-popover-trigger-width] min-w-[12rem] p-0"
        align="start"
      >
        <div onKeyDown={handleKeyDown}>
          {searchPlaceholder ? (
            <div className="flex items-center border-b border-border px-3">
              <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                className="flex h-9 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setFocusIdx(0);
                }}
              />
            </div>
          ) : null}
          <div ref={listRef} className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No matches found.
              </div>
            ) : (
              filtered.map((option, idx) => {
                itemRef(idx);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      'relative flex w-full cursor-pointer items-center rounded-sm px-3 py-1.5 text-left text-sm outline-none',
                      idx === focusIdx
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground hover:bg-muted',
                    )}
                    onClick={() => select(option.value)}
                    onMouseEnter={() => setFocusIdx(idx)}
                  >
                    {option.label}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default Combobox;
