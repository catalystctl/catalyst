import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '../../lib/utils';

interface PasswordStrengthMeterProps {
 password: string;
 className?: string;
}

type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong' | 'veryStrong';

/**
 * Localized strength label. A switch keeps every translation key a literal in
 * the source (see `serverStatusLabel` in utils/constants.ts).
 */
function strengthLabel(t: TFunction, level: StrengthLevel): string {
  switch (level) {
    case 'weak':
      return t('passwordStrength.weak');
    case 'fair':
      return t('passwordStrength.fair');
    case 'good':
      return t('passwordStrength.good');
    case 'strong':
      return t('passwordStrength.strong');
    default:
      return t('passwordStrength.veryStrong');
  }
}

// Simple password strength calculation without external library
function calculateStrength(password: string): { score: number; level: StrengthLevel; color: string } {
 if (!password) {
 return { score: 0, level: 'weak', color: 'bg-surface-3' };
 }

 let score = 0;

 // Length checks
 if (password.length >= 8) score++;
 if (password.length >= 12) score++;
 if (password.length >= 16) score++;

 // Character variety checks
 if (/[a-z]/.test(password)) score++;
 if (/[A-Z]/.test(password)) score++;
 if (/[0-9]/.test(password)) score++;
 if (/[^a-zA-Z0-9]/.test(password)) score++;

 // Normalize to 0-4 scale
 const normalizedScore = Math.min(4, Math.floor(score / 2));

 const levels: Array<{ level: StrengthLevel; color: string }> = [
 { level: 'weak', color: 'bg-destructive/50' },
 { level: 'fair', color: 'bg-danger' },
 { level: 'good', color: 'bg-warning' },
 { level: 'strong', color: 'bg-success/70' },
 { level: 'veryStrong', color: 'bg-success' },
 ];

 return {
 score: normalizedScore,
 level: levels[normalizedScore].level,
 color: levels[normalizedScore].color,
 };
}

export function PasswordStrengthMeter({ password, className }: PasswordStrengthMeterProps) {
 const { t } = useTranslation('common');
 const strength = useMemo(() => calculateStrength(password), [password]);

 if (!password) return null;

 return (
 <div className={cn('space-y-1', className)}>
 <div className="flex items-center justify-between text-xs">
 <span className="text-muted-foreground">{t('passwordStrength.title')}</span>
 <span
 className={cn(
 'font-medium',
 strength.score <= 1 && 'text-destructive',
 strength.score === 2 && 'text-danger',
 strength.score === 3 && 'text-warning',
 strength.score >= 4 && 'text-success'
 )}
 >
 {strengthLabel(t, strength.level)}
 </span>
 </div>
 <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
 <div
 className={cn('h-full rounded-full transition-all duration-300', strength.color)}
 style={{ width: `${((strength.score + 1) / 5) * 100}%` }}
 />
 </div>
 </div>
 );
}

export default PasswordStrengthMeter;
