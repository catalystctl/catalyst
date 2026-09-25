import { useTranslation } from 'react-i18next';
import { Check, Globe } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useLocale } from '../../i18n/useLocale';

interface LanguageSwitcherProps {
  /**
   * `compact` is the icon-only trigger used on signed-out screens;
   * `full` shows the active language name (profile settings).
   */
  variant?: 'compact' | 'full';
  align?: 'start' | 'end';
  /** Applied to the dropdown content (width and placement are page-specific). */
  contentClassName?: string;
  className?: string;
}

export default function LanguageSwitcher({
  variant = 'full',
  align = 'end',
  contentClassName = '',
  className = '',
}: LanguageSwitcherProps) {
  const { t } = useTranslation();
  const { locale, setLocale, supportedLocales } = useLocale();
  const active = supportedLocales.find((option) => option.code === locale);

  const trigger =
    variant === 'compact' ? (
      <button
        type="button"
        aria-label={t('language.label')}
        title={t('language.label')}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border/60 bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground ${className}`}
      >
        <Globe className="h-4 w-4" />
      </button>
    ) : (
      <button
        type="button"
        aria-label={t('language.label')}
        className={`inline-flex h-8 w-full items-center gap-2 rounded-sm border border-border/60 bg-card px-2.5 text-mini text-foreground transition-colors hover:border-primary/40 ${className}`}
      >
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 text-left">{active?.nativeName ?? locale}</span>
      </button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName}>
        <DropdownMenuLabel>{t('language.label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {supportedLocales.map((option) => (
          <DropdownMenuItem
            key={option.code}
            onSelect={() => {
              void setLocale(option.code);
            }}
            className="gap-2"
          >
            <span className="flex-1">{option.nativeName}</span>
            {option.code === locale && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
