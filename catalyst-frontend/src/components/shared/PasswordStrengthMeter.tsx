import { useMemo } from 'react';
import { cn } from '../../lib/utils';

interface PasswordStrengthMeterProps {
  password: string;
  className?: string;
}

function calculateStrength(password: string): { score: number; label: string; color: string; textColor: string } {
  if (!password) {
    return { score: 0, label: '', color: 'bg-surface-2', textColor: '' };
  }

  let score = 0;

  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;

  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  const normalizedScore = Math.min(4, Math.floor(score / 2));

  const levels = [
    { label: 'Weak', color: 'bg-destructive', textColor: 'text-destructive' },
    { label: 'Fair', color: 'bg-amber-500', textColor: 'text-amber-500' },
    { label: 'Good', color: 'bg-amber-500', textColor: 'text-amber-500' },
    { label: 'Strong', color: 'bg-emerald-500', textColor: 'text-emerald-500' },
    { label: 'Very Strong', color: 'bg-emerald-500', textColor: 'text-emerald-500' },
  ];

  return {
    score: normalizedScore,
    label: levels[normalizedScore].label,
    color: levels[normalizedScore].color,
    textColor: levels[normalizedScore].textColor,
  };
}

export function PasswordStrengthMeter({ password, className }: PasswordStrengthMeterProps) {
  const strength = useMemo(() => calculateStrength(password), [password]);

  if (!password) return null;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Password strength</span>
        <span className={cn('font-medium', strength.textColor)}>
          {strength.label}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn('h-full rounded-full transition-all duration-300', strength.color)}
          style={{ width: `${((strength.score + 1) / 5) * 100}%` }}
        />
      </div>
    </div>
  );
}

export default PasswordStrengthMeter;
