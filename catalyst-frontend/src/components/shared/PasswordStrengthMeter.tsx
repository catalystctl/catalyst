import { useMemo } from 'react';
import { cn } from '../../lib/utils';

interface PasswordStrengthMeterProps {
  password: string;
  className?: string;
}

// Simple password strength calculation without external library
function calculateStrength(password: string): { score: number; label: string; color: string } {
  if (!password) {
    return { score: 0, label: '', color: 'bg-slate-200 dark:bg-slate-700' };
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

  const levels = [
    { label: 'Weak', color: 'bg-red-500' },
    { label: 'Fair', color: 'bg-orange-500' },
    { label: 'Good', color: 'bg-yellow-500' },
    { label: 'Strong', color: 'bg-green-400' },
    { label: 'Very Strong', color: 'bg-green-600' },
  ];

  return {
    score: normalizedScore,
    label: levels[normalizedScore].label,
    color: levels[normalizedScore].color,
  };
}

export function PasswordStrengthMeter({ password, className }: PasswordStrengthMeterProps) {
  const strength = useMemo(() => calculateStrength(password), [password]);

  if (!password) return null;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-600 dark:text-slate-400">Password strength</span>
        <span
          className={cn(
            'font-medium',
            strength.score <= 1 && 'text-red-600 dark:text-red-400',
            strength.score === 2 && 'text-orange-600 dark:text-orange-400',
            strength.score === 3 && 'text-yellow-600 dark:text-yellow-400',
            strength.score >= 4 && 'text-green-600 dark:text-green-400'
          )}
        >
          {strength.label}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className={cn('h-full rounded-full transition-all duration-300', strength.color)}
          style={{ width: `${((strength.score + 1) / 5) * 100}%` }}
        />
      </div>
    </div>
  );
}

export default PasswordStrengthMeter;
