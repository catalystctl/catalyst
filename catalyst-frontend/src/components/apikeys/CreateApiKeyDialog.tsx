import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, CheckCircle2, AlertTriangle, Key, Shield, ShieldCheck, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useCreateApiKey, usePermissionsCatalog, useMyPermissions } from '../../hooks/useApiKeys';
import { CreateApiKeyRequest, PermissionCategory } from '../../services/apiKeys';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
 Dialog,
 DialogBody,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from '@/components/ui/dialog';

interface CreateApiKeyDialogProps {
 open: boolean;
 onOpenChange: (open: boolean) => void;
}

export function CreateApiKeyDialog({ open, onOpenChange }: CreateApiKeyDialogProps) {
 const { t } = useTranslation('profile');
 const createApiKey = useCreateApiKey();
 const { data: catalog, isLoading: catalogLoading } = usePermissionsCatalog();
 const { data: myPermissions = [] } = useMyPermissions();
 const expirationOptions = [
 { label: t('apiKeys.expiration.never'), value: 0 },
 { label: t('apiKeys.expiration.days7'), value: 604800 },
 { label: t('apiKeys.expiration.days30'), value: 2592000 },
 { label: t('apiKeys.expiration.days90'), value: 7776000 },
 { label: t('apiKeys.expiration.days180'), value: 15552000 },
 { label: t('apiKeys.expiration.year1'), value: 31536000 },
 ];

 const [formData, setFormData] = useState<CreateApiKeyRequest & { permissions: string[] }>({
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
 toast.error(t('apiKeys.createDialog.nameRequired'));
 return;
 }
 if (!formData.allPermissions && formData.permissions.length === 0) {
 toast.error(t('apiKeys.createDialog.permissionRequired'));
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
 toast.success(t('apiKeys.createDialog.copied'));
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
 setFormData({ name: '', expiresIn: 7776000, allPermissions: true, permissions: [], rateLimitMax: 100, rateLimitTimeWindow: 60000 });
 setCreatedKey(null);
 setCopied(false);
 setExpandedCategories(new Set());
 }
 }, [open]);


 return (
 <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
 <DialogContent size="lg">
 <DialogHeader icon={<Key className="h-4 w-4" />}>
 <DialogTitle>{createdKey ? t('apiKeys.createDialog.createdTitle') : t('apiKeys.createDialog.title')}</DialogTitle>
 <DialogDescription>
 {createdKey
 ? t('apiKeys.createDialog.createdDescription')
 : t('apiKeys.createDialog.description')}
 </DialogDescription>
 </DialogHeader>
 {!createdKey ? (
 <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
 <DialogBody className="space-y-5">
 <div className="space-y-1.5">
 <label className="type-overline">{t('apiKeys.form.name')}</label>
 <Input
 type="text"
 className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
 placeholder={t('apiKeys.form.namePlaceholder')}
 value={formData.name}
 onChange={(e) => setFormData({ ...formData, name: e.target.value })}
 required
 />
 <p className="type-meta">{t('apiKeys.form.nameHint')}</p>
 </div>

 <div className="space-y-2">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Shield className="h-3.5 w-3.5 text-muted-foreground" />
 <label className="type-overline">{t('apiKeys.form.permissions')}</label>
 </div>
 {selectedCount >= 0 && (
 <Badge variant="outline" className="font-mono text-micro tabular-nums">
 {t('apiKeys.form.selectedCount', { count: selectedCount })}
 </Badge>
 )}
 </div>

 <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 px-3 py-2">
 <div className="flex items-center gap-2.5">
 <ShieldCheck className="h-3.5 w-3.5 text-success dark:text-success" />
 <div>
 <span className="text-mini font-semibold text-foreground dark:text-foreground">
 {t('apiKeys.form.allMine')}
 </span>
 <p className="type-meta">
 {t('apiKeys.form.inherits', {
 summary: userHasWildcard
 ? t('apiKeys.form.inheritSuperAdmin')
 : t('apiKeys.form.inheritCount', { count: myPermissions.length }),
 })}
 </p>
 </div>
 </div>
 <Switch
 checked={formData.allPermissions}
 onCheckedChange={(checked) => setFormData({ ...formData, allPermissions: checked, permissions: [] })}
 />
 </div>

 {!formData.allPermissions && (
 <div className="overflow-hidden rounded-sm border border-border/50">
 <div className="max-h-64 overflow-y-auto">
 {catalogLoading ? (
 <div className="flex items-center justify-center py-8">
 <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
 <span className="ml-2 text-mini text-muted-foreground">{t('apiKeys.form.loading')}</span>
 </div>
 ) : availablePermissions.length === 0 ? (
 <div className="type-meta px-3 py-6 text-center">
 {t('apiKeys.form.noneAvailable')}
 </div>
 ) : (
 availablePermissions.map((cat) => {
 if (cat.permissions.length === 0) return null;
 const expanded = expandedCategories.has(cat.id);
 const fullySelected = isCategoryFullySelected(cat);
 const partiallySelected = isCategoryPartiallySelected(cat);

 return (
 <div key={cat.id} className="border-b border-border/50 last:border-b-0">
 <button
 type="button"
 onClick={() => toggleCategory(cat.id)}
 className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-1/40"
 >
 <input
 type="checkbox"
 checked={fullySelected}
 ref={(el) => {
 if (el) el.indeterminate = partiallySelected;
 }}
 onChange={(e) => { e.stopPropagation(); selectCategoryAll(cat); }}
 onClick={(e) => e.stopPropagation()}
 className="h-3.5 w-3.5 rounded-sm border-border/60 bg-background/40 text-primary focus:ring-primary"
 />
 <span className="flex-1">
 <span className="text-mini font-medium text-foreground dark:text-foreground">{cat.label}</span>
 <span className="ml-2 font-mono text-micro tabular-nums text-muted-foreground">({cat.permissions.length})</span>
 </span>
 {expanded ? (
 <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
 ) : (
 <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
 )}
 </button>

 {expanded && (
 <div className="border-t border-border/50 px-3 pb-2 pt-1">
 {cat.permissions.map((perm) => (
 <label
 key={perm.value}
 className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-mini transition-colors hover:bg-surface-1/40"
 >
 <input
 type="checkbox"
 checked={formData.permissions.includes(perm.value)}
 onChange={() => togglePermission(perm.value)}
 className="h-3.5 w-3.5 rounded-sm border-border/60 bg-background/40 text-primary focus:ring-primary"
 />
 <span className="text-foreground dark:text-foreground">{perm.label}</span>
 <code className="ml-auto font-mono text-micro tabular-nums text-muted-foreground">{perm.value}</code>
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
 <p className="text-mini text-warning dark:text-warning">
 ⚠ {t('apiKeys.form.selectAtLeastOne')}
 </p>
 )}
 </div>

 <div className="space-y-1.5">
 <label className="type-overline">{t('apiKeys.form.expiration')}</label>
 <select
 value={formData.expiresIn}
 onChange={(e) => setFormData({ ...formData, expiresIn: Number(e.target.value) })}
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40 dark:border-border/60 dark:bg-background/40 dark:text-foreground"
 >
 {expirationOptions.map((opt) => (
 <option key={opt.value} value={opt.value}>{opt.label}</option>
 ))}
 </select>
 </div>

 <div className="space-y-1.5">
 <label className="type-overline">{t('apiKeys.form.rateLimit')}</label>
 <div className="flex items-center gap-2">
 <Input
 type="number"
 min={1}
 max={10000}
 value={formData.rateLimitMax}
 onChange={(e) => setFormData({ ...formData, rateLimitMax: Number(e.target.value) })}
 className="h-8 w-32 rounded-sm border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums"
 />
 <span className="text-mini text-muted-foreground">{t('apiKeys.form.perMinute')}</span>
 </div>
 <p className="type-meta">{t('apiKeys.form.rateLimitHint')}</p>
 </div>
 </DialogBody>
 <DialogFooter>
 <Button variant="outline" size="sm" type="button" className="h-8 px-3 text-mini" onClick={handleClose}>{t('common:actions.cancel')}</Button>
 <Button size="sm" type="submit" className="h-8 px-3 text-mini" disabled={createApiKey.isPending || (!formData.allPermissions && formData.permissions.length === 0)}>
 {createApiKey.isPending ? t('apiKeys.createDialog.creating') : t('apiKeys.createDialog.submit')}
 </Button>
 </DialogFooter>
 </form>
 ) : (
 <>
 <DialogBody className="space-y-4">
 <div className="flex items-start gap-2.5 rounded-sm border border-warning/30 bg-warning/5 px-3 py-2 dark:border-warning/20 dark:bg-warning/15">
 <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning dark:text-warning" />
 <p className="text-mini text-warning dark:text-warning">
 {t('apiKeys.createDialog.keepCopyWarning')}
 </p>
 </div>

 <div className="space-y-1.5">
 <label className="type-overline">{t('apiKeys.createDialog.yourKey')}</label>
 <div className="flex min-w-0 gap-2">
 <input
 readOnly
 value={createdKey}
 className="h-8 min-w-0 flex-1 rounded-sm border border-border/60 bg-surface-0 px-2.5 font-mono text-mini tabular-nums text-foreground focus:outline-none dark:border-border/60 dark:bg-surface-0 dark:text-foreground"
 onFocus={(e) => e.target.select()}
 />
 <button
 onClick={handleCopy}
 className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground dark:border-border/60"
 >
 {copied ? (
 <CheckCircle2 className="h-4 w-4 text-success" />
 ) : (
 <Copy className="h-4 w-4" />
 )}
 </button>
 </div>
 </div>

 <div className="min-w-0 rounded-sm border border-border/50 bg-surface-0 p-3 dark:bg-surface-0">
 <h4 className="type-overline mb-2">{t('apiKeys.createDialog.usageExample')}</h4>
 <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all font-mono text-micro tabular-nums text-foreground dark:text-foreground">
 <code>{`curl -H "Authorization: Bearer ${createdKey}" \\
 ${window.location.origin}/api/servers`}</code>
 </pre>
 </div>
 </DialogBody>
 <DialogFooter>
 <Button size="sm" className="h-8 px-3 text-mini" onClick={handleClose}>{t('done')}</Button>
 </DialogFooter>
 </>
 )}
 </DialogContent>
 </Dialog>
 );
}
