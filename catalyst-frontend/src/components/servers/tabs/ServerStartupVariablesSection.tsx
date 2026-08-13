import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@/csync';
import { Save, RotateCcw, AlertCircle, CheckCircle2, Cog } from 'lucide-react';
import { qk } from '../../../lib/queryKeys';
import { serversApi } from '../../../services/api/servers';
import { notifyError, notifySuccess } from '../../../utils/notify';
import type { ServerStartupVariable } from '../../../types/server';
import SectionHeader from './SectionHeader';

// Stable empty fallback — inline `?? []` / ternary `[]` recreates identity every
// render and infinite-loops the React 19 prev-state sync while loading.
const EMPTY_STARTUP_VARIABLES: ServerStartupVariable[] = [];

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
 data: variablesData,
 isLoading,
 isError,
 } = useQuery<ServerStartupVariable[]>({
 queryKey: qk.serverVariables(serverId),
 queryFn: () => serversApi.getVariables(serverId),
 enabled: Boolean(serverId),
 staleTime: 60_000,
 // Must return stable empty ref — fresh `[]` every read re-triggers prev-state sync.
 select: (data) => (Array.isArray(data) ? data : EMPTY_STARTUP_VARIABLES),
 });
 // Always an array for .forEach/.map/.some — never trust raw cache shape.
 // EMPTY_STARTUP_VARIABLES is module-scoped so identity is stable while loading.
 const variables = Array.isArray(variablesData) ? variablesData : EMPTY_STARTUP_VARIABLES;

 // Sync local values when the *query result identity* changes (real data load/refetch).
 // Do not use a fresh [] fallback here — that loops under React 19.
 const [prevVariables, setPrevVariables] = useState(variables);
 if (variables !== prevVariables) {
 setPrevVariables(variables);
 // Reset local form state on real loads (including empty template → clear fields).
 const next: Record<string, string> = {};
 for (const v of variables) {
 next[v.name] = v.value;
 }
 setLocalValues(next);
 setLocalErrors({});
 setTouched(new Set());
 }

 const updateMutation = useMutation({
 mutationFn: (payload: Record<string, string>) =>
 serversApi.updateVariables(serverId, payload),
 onSuccess: () => {
 notifySuccess('Startup variables saved');
 setTouched(new Set());
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.serverVariables(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
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
 if (variables.length === 0) return false;
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
 if (variables.length === 0) return;
 const payload: Record<string, string> = {};
 variables.forEach((v) => {
 if (v.name in localValues) {
 payload[v.name] = localValues[v.name];
 }
 });
 updateMutation.mutate(payload);
 };

 const handleReset = () => {
 if (variables.length === 0) return;
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
 ? 'border-danger/40 focus:border-danger'
 : 'border-border/40 focus:border-primary');

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
    <div>
      <div className="flex items-center justify-between gap-3">
        <SectionHeader icon={Cog} title="Startup variables" />
        {canEdit && !isSuspended && (
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-surface-2"
                onClick={handleReset}
                disabled={updateMutation.isPending}
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
            <button
              type="button"
              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              onClick={handleSave}
              disabled={!hasChanges || isSuspended || updateMutation.isPending}
            >
              <Save className="h-3 w-3" />
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <div className="mt-2">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-surface-2" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 py-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4" />
            Failed to load startup variables
          </div>
        ) : variables.length === 0 ? (
          <p className="type-meta py-3">No startup variables on this template.</p>
        ) : (
          <div>
            {variables.map((variable) => {
              const value = localValues[variable.name] ?? variable.value ?? '';
              const error = localErrors[variable.name] || (touched.has(variable.name) ? clientValidate(variable, value) : null);
              const changed = isDirty(variable);
              return (
                <div
                  key={variable.name}
                  className={`flex flex-wrap items-center justify-between gap-3 border-b border-border/40 py-2.5 last:border-0 ${
                    error ? 'bg-danger/5' : changed ? 'bg-primary/5' : ''
                  }`}
                >
                  <div className="min-w-[10rem] flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <span className="font-mono text-xs">{variable.name}</span>
                      {variable.required && <span className="text-danger">*</span>}
                      {changed && !error && <CheckCircle2 className="h-3 w-3 text-primary" />}
                    </div>
                    {error && (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-danger">
                        <AlertCircle className="h-3 w-3" />
                        {error}
                      </p>
                    )}
                  </div>
                  <div className="w-full sm:w-64">{renderInput(variable)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

}
