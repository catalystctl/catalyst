import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Copy, CheckCircle2, AlertTriangle, Key, Shield, ShieldCheck, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useCreateApiKey, usePermissionsCatalog, useMyPermissions } from '../../hooks/useApiKeys';
import { CreateApiKeyRequest, PermissionCategory } from '../../services/apiKeys';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ModalPortal } from '@/components/ui/modal-portal';

interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const expirationOptions = [
  { label: 'Never expires', value: 0 },
  { label: '7 days', value: 604800 },
  { label: '30 days', value: 2592000 },
  { label: '90 days (recommended)', value: 7776000 },
  { label: '180 days', value: 15552000 },
  { label: '1 year', value: 31536000 },
];

export function CreateApiKeyDialog({ open, onOpenChange }: CreateApiKeyDialogProps) {
  const createApiKey = useCreateApiKey();
  const { data: catalog, isLoading: catalogLoading } = usePermissionsCatalog();
  const { data: myPermissions = [] } = useMyPermissions();

  const [formData, setFormData] = useState<CreateApiKeyRequest>({
    name: '',
    expiresIn: 7776000,
    allPermissions: true,
    permissions: [],
    rateLimitMax: 100,
    rateLimitTimeWindow: 60000,
  });
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Determine what permissions the user can grant
  const userHasWildcard = myPermissions.includes('*');
  const availablePermissions = useMemo(() => {
    if (!catalog) return [];
    return catalog.map((cat) => ({
      ...cat,
      // Only include permissions the user actually has (unless wildcard)
      permissions: cat.permissions.filter(
        (p) => userHasWildcard || myPermissions.includes(p.value),
      ),
      // Exclude the wildcard '*' from category permissions — handled by allPermissions toggle
    }));
  }, [catalog, myPermissions, userHasWildcard]);

  const selectedCount = formData.allPermissions ? -1 : formData.permissions.length;

  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const togglePermission = (value: string) => {
    setFormData((prev) => {
      if (prev.allPermissions) return prev; // Can't toggle when "all" is selected
      const perms = prev.permissions.includes(value)
        ? prev.permissions.filter((p) => p !== value)
        : [...prev.permissions, value];
      return { ...prev, permissions: perms };
    });
  };

  const selectCategoryAll = (cat: PermissionCategory) => {
    if (formData.allPermissions) return;
    const catValues = cat.permissions.map((p) => p.value);
    const allSelected = catValues.every((v) => formData.permissions.includes(v));
    setFormData((prev) => {
      const existing = prev.permissions.filter((p) => !catValues.includes(p));
      if (!allSelected) {
        return { ...prev, permissions: [...existing, ...catValues] };
      }
      return { ...prev, permissions: existing };
    });
  };

  const isCategoryFullySelected = (cat: PermissionCategory) =>
    cat.permissions.length > 0 && cat.permissions.every((p) => formData.permissions.includes(p.value));

  const isCategoryPartiallySelected = (cat: PermissionCategory) =>
    cat.permissions.some((p) => formData.permissions.includes(p.value)) && !isCategoryFullySelected(cat);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Please enter a name for the API key');
      return;
    }
    if (!formData.allPermissions && formData.permissions.length === 0) {
      toast.error('Select at least one permission or enable "All my permissions"');
      return;
    }
    try {
      const payload = { ...formData };
      if (payload.expiresIn === 0) delete payload.expiresIn;
      const result = await createApiKey.mutateAsync(payload);
      setCreatedKey(result.key);
    } catch {
      // Error toast handled by mutation
    }
  };

  const handleCopy = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      toast.success('API key copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setFormData({ name: '', expiresIn: 7776000, allPermissions: true, permissions: [], rateLimitMax: 100, rateLimitTimeWindow: 60000 });
    setCreatedKey(null);
    setCopied(false);
    setExpandedCategories(new Set());
    onOpenChange(false);
  };

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({ name: '', expiresIn: 7776000, allPermissions: true, permissions: [], rateLimitMax: 100, rateLimitTimeWindow: 60000 });
      setCreatedKey(null);
      setCopied(false);
      setExpandedCategories(new Set());
    }
  }, [open]);

  if (!open) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="mx-4 w-full max-w-2xl rounded-xl border border-border bg-card shadow-xl"
      >
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/30">
              <Key className="h-4 w-4 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground dark:text-white">
                {createdKey ? 'API Key Created' : 'Create API Key'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {createdKey
                  ? 'Copy your API key now — it won\'t be shown again.'
                  : 'Generate a new key for automated access to Catalyst.'}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          {!createdKey ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground dark:text-zinc-100">Name *</label>
                <Input
                  type="text"
                  placeholder="e.g., Billing System Integration"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
                <p className="text-[11px] text-muted-foreground">A descriptive name to identify this API key.</p>
              </div>

              {/* Permissions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                    <label className="text-xs font-medium text-foreground dark:text-zinc-100">Permissions</label>
                  </div>
                  {selectedCount >= 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {selectedCount} permission{selectedCount !== 1 ? 's' : ''} selected
                    </Badge>
                  )}
                </div>

                {/* All permissions toggle */}
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/50 px-4 py-3 dark:bg-surface-2/30">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <span className="text-sm font-medium text-foreground dark:text-zinc-100">
                        All my permissions
                      </span>
                      <p className="text-[11px] text-muted-foreground">
                        Key inherits all your current permissions ({userHasWildcard ? 'super admin' : `${myPermissions.length} permissions`})
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={formData.allPermissions}
                    onCheckedChange={(checked) => setFormData({ ...formData, allPermissions: checked, permissions: [] })}
                  />
                </div>

                {/* Category-based permission selector */}
                {!formData.allPermissions && (
                  <div className="rounded-lg border border-border overflow-hidden">
                    <div className="max-h-64 overflow-y-auto">
                      {catalogLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          <span className="ml-2 text-sm text-muted-foreground">Loading permissions…</span>
                        </div>
                      ) : availablePermissions.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                          No permissions available
                        </div>
                      ) : (
                        availablePermissions.map((cat) => {
                          if (cat.permissions.length === 0) return null;
                          const expanded = expandedCategories.has(cat.id);
                          const fullySelected = isCategoryFullySelected(cat);
                          const partiallySelected = isCategoryPartiallySelected(cat);

                          return (
                            <div key={cat.id} className="border-b border-border/50 last:border-b-0">
                              {/* Category header */}
                              <button
                                type="button"
                                onClick={() => toggleCategory(cat.id)}
                                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/50"
                              >
                                <input
                                  type="checkbox"
                                  checked={fullySelected}
                                  ref={(el) => {
                                    if (el) el.indeterminate = partiallySelected;
                                  }}
                                  onChange={(e) => { e.stopPropagation(); selectCategoryAll(cat); }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="rounded border-border text-primary-600 focus:ring-primary-500 dark:border-zinc-600"
                                />
                                <span className="flex-1">
                                  <span className="text-sm font-medium text-foreground dark:text-zinc-100">{cat.label}</span>
                                  <span className="ml-2 text-[11px] text-muted-foreground">({cat.permissions.length})</span>
                                </span>
                                {expanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                              </button>

                              {/* Expanded permissions */}
                              {expanded && (
                                <div className="border-t border-border/30 bg-surface-1/50 px-4 pb-2 pt-1 dark:bg-surface-1/30">
                                  {cat.permissions.map((perm) => (
                                    <label
                                      key={perm.value}
                                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-surface-2/50 cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={formData.permissions.includes(perm.value)}
                                        onChange={() => togglePermission(perm.value)}
                                        className="rounded border-border text-primary-600 focus:ring-primary-500 dark:border-zinc-600"
                                      />
                                      <span className="text-foreground dark:text-zinc-200">{perm.label}</span>
                                      <code className="ml-auto text-[10px] text-muted-foreground">{perm.value}</code>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {!formData.allPermissions && selectedCount === 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    ⚠ Select at least one permission above
                  </p>
                )}
              </div>

              {/* Expiration */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground dark:text-zinc-100">Expiration</label>
                <select
                  value={formData.expiresIn}
                  onChange={(e) => setFormData({ ...formData, expiresIn: Number(e.target.value) })}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-1 dark:text-zinc-200"
                >
                  {expirationOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Rate Limit */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground dark:text-zinc-100">Rate Limit</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={10000}
                    value={formData.rateLimitMax}
                    onChange={(e) => setFormData({ ...formData, rateLimitMax: Number(e.target.value) })}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">requests per minute</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Maximum requests allowed per minute.</p>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 border-t border-border/50 pt-4">
                <Button variant="outline" size="sm" type="button" onClick={handleClose}>Cancel</Button>
                <Button size="sm" type="submit" disabled={createApiKey.isPending || (!formData.allPermissions && formData.permissions.length === 0)}>
                  {createApiKey.isPending ? 'Creating…' : 'Create API Key'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              {/* Warning */}
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-300/40 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-900/15">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Make sure to copy your API key now. You won&apos;t be able to see it again!
                </p>
              </div>

              {/* Key display */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground dark:text-zinc-100">Your API Key</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={createdKey}
                    className="flex-1 rounded-lg border border-border bg-white px-3 py-2 font-mono text-sm text-foreground focus:outline-none dark:border-border dark:bg-surface-1 dark:text-zinc-100"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    onClick={handleCopy}
                    className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground dark:border-border"
                  >
                    {copied ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Usage example */}
              <div className="rounded-lg border border-border/50 bg-surface-2/50 p-4 dark:bg-surface-2/30">
                <h4 className="mb-2 text-xs font-semibold text-foreground dark:text-zinc-100">Usage Example</h4>
                <pre className="overflow-x-auto text-xs text-foreground dark:text-zinc-300">
                  <code>{`curl -H "Authorization: Bearer ${createdKey}" \\
  ${window.location.origin}/api/servers`}</code>
                </pre>
              </div>

              <div className="flex justify-end border-t border-border/50 pt-4">
                <Button size="sm" onClick={handleClose}>Done</Button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
    </ModalPortal>
  );
}
