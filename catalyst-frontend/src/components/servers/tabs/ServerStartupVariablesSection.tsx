import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, RotateCcw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { qk } from '../../../lib/queryKeys';
import { serversApi } from '../../../services/api/servers';
import { notifyError, notifySuccess } from '../../../utils/notify';
import type { ServerStartupVariable } from '../../../types/server';

interface Props {
  serverId: string;
  isSuspended: boolean;
  canEdit: boolean;
}

export default function ServerStartupVariablesSection({
  serverId,
  isSuspended,
  canEdit,
}: Props) {
  const queryClient = useQueryClient();
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const {
    data: variables,
    isLoading,
    isError,
  } = useQuery<ServerStartupVariable[]>({
    queryKey: qk.serverVariables(serverId),
    queryFn: () => serversApi.getVariables(serverId),
    enabled: Boolean(serverId),
    refetchInterval: 15000,
  });

  // Sync local values when variables load
  useEffect(() => {
    if (variables) {
      const next: Record<string, string> = {};
      variables.forEach((v) => {
        next[v.name] = v.value;
      });
      setLocalValues(next);
      setLocalErrors({});
      setTouched(new Set());
    }
  }, [variables?.length, serverId]);

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, string>) =>
      serversApi.updateVariables(serverId, payload),
    onSuccess: () => {
      notifySuccess('Startup variables saved');
      queryClient.invalidateQueries({ queryKey: qk.serverVariables(serverId) });
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      setTouched(new Set());
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to save variables';
      const fields = error?.response?.data?.fields as Record<string, string> | undefined;
      if (fields) {
        setLocalErrors(fields);
      }
      notifyError(message);
    },
  });

  const hasChanges = useMemo(() => {
    if (!variables) return false;
    return variables.some((v) => localValues[v.name] !== v.value);
  }, [variables, localValues]);

  const handleChange = (name: string, value: string) => {
    setLocalValues((prev) => ({ ...prev, [name]: value }));
    setTouched((prev) => new Set(prev).add(name));
    // Clear error when user types
    if (localErrors[name]) {
      setLocalErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleSave = () => {
    if (!variables) return;
    const payload: Record<string, string> = {};
    variables.forEach((v) => {
      if (v.name in localValues) {
        payload[v.name] = localValues[v.name];
      }
    });
    updateMutation.mutate(payload);
  };

  const handleReset = () => {
    if (!variables) return;
    const next: Record<string, string> = {};
    variables.forEach((v) => {
      next[v.name] = v.value;
    });
    setLocalValues(next);
    setLocalErrors({});
    setTouched(new Set());
  };

  const clientValidate = (variable: ServerStartupVariable, value: string): string | null => {
    if (variable.required && value.trim() === '') {
      return 'This field is required';
    }
    if (variable.input === 'number' && value.trim() !== '' && Number.isNaN(Number(value))) {
      return 'Must be a valid number';
    }
    for (const rule of variable.rules) {
      const [ruleName, ...rest] = rule.split(':');
      const param = rest.join(':');
      if (ruleName === 'between') {
        const [minStr, maxStr] = param.split(',');
        const num = Number(value);
        const min = Number(minStr);
        const max = Number(maxStr);
        if (!Number.isNaN(num) && !Number.isNaN(min) && !Number.isNaN(max)) {
          if (num < min || num > max) {
            return `Must be between ${min} and ${max}`;
          }
        }
      }
      if (ruleName === 'regex') {
        try {
          const re = new RegExp(param);
          if (!re.test(value)) {
            return 'Invalid format';
          }
        } catch {
          // ignore invalid regex
        }
      }
      if (ruleName === 'in') {
        const allowed = param.split(',');
        if (!allowed.includes(value)) {
          return `Must be one of: ${allowed.join(', ')}`;
        }
      }
    }
    return null;
  };

  const isDirty = (variable: ServerStartupVariable) =>
    localValues[variable.name] !== variable.value;

  const renderInput = (variable: ServerStartupVariable) => {
    const value = localValues[variable.name] ?? variable.value ?? '';
    const error = localErrors[variable.name] || (touched.has(variable.name) ? clientValidate(variable, value) : null);
    const disabled = !canEdit || isSuspended || updateMutation.isPending;
    const inputClasses =
      'w-full rounded-md border bg-card px-2.5 py-1.5 text-xs text-foreground transition-all duration-300 focus:outline-none ' +
      (error
        ? 'border-danger focus:border-danger'
        : 'border-border focus:border-primary');

    if (variable.input === 'checkbox') {
      const checked = value === 'true' || value === '1' || value === 'on';
      return (
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={checked}
            onChange={(e) => handleChange(variable.name, e.target.checked ? 'true' : 'false')}
            disabled={disabled}
          />
          <div className="h-5 w-10 rounded-full bg-surface-3 transition peer-checked:bg-primary dark:bg-surface-2" />
          <div className="pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-card shadow transition peer-checked:translate-x-5" />
        </label>
      );
    }

    if (variable.input === 'number') {
      return (
        <input
          type="number"
          className={inputClasses}
          value={value}
          onChange={(e) => handleChange(variable.name, e.target.value)}
          disabled={disabled}
          placeholder={variable.default}
        />
      );
    }

    // text and select fallback
    return (
      <input
        type="text"
        className={inputClasses}
        value={value}
        onChange={(e) => handleChange(variable.name, e.target.value)}
        disabled={disabled}
        placeholder={variable.default}
      />
    );
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-5 shadow-sm backdrop-blur-sm hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-foreground">Startup variables</div>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
            Variables defined by the template. These are substituted into the startup command and
            available as environment variables inside the container.
          </p>
        </div>
        {canEdit && !isSuspended && (
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-surface-2"
                onClick={handleReset}
                disabled={updateMutation.isPending}
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
            <button
              type="button"
              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[10px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
              onClick={handleSave}
              disabled={!hasChanges || isSuspended || updateMutation.isPending}
            >
              <Save className="h-3 w-3" />
              {updateMutation.isPending ? 'Saving…' : 'Save variables'}
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-xs text-danger">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span>Failed to load startup variables</span>
            </div>
          </div>
        ) : !variables || variables.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No startup variables defined for this template.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {variables.map((variable) => {
              const value = localValues[variable.name] ?? variable.value ?? '';
              const error = localErrors[variable.name] || (touched.has(variable.name) ? clientValidate(variable, value) : null);
              const changed = isDirty(variable);

              return (
                <div
                  key={variable.name}
                  className={`rounded-lg border p-3 transition-all duration-300 ${
                    error
                      ? 'border-danger/40 bg-danger-muted/30'
                      : changed
                        ? 'border-primary/30 bg-primary-muted/20'
                        : 'border-border bg-surface-2/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-foreground">
                      {variable.name}
                      {variable.required && (
                        <span className="ml-0.5 text-danger">*</span>
                      )}
                    </label>
                    {changed && !error && (
                      <CheckCircle2 className="h-3 w-3 text-primary" />
                    )}
                  </div>
                  {variable.description && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {variable.description}
                    </p>
                  )}
                  <div className="mt-2">{renderInput(variable)}</div>
                  {error && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-danger">
                      <AlertCircle className="h-3 w-3" />
                      {error}
                    </p>
                  )}
                  {variable.rules.length > 0 && !error && (
                    <p className="mt-1 text-[10px] text-muted-foreground/70">
                      Rules: {variable.rules.join(', ')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
