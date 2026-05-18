import { useCallback, useState } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { notifySuccess, notifyError } from '../../../utils/notify';

/**
 * Canonical data field row — replaces both CopyableValue and CredentialField.
 * Shows a label on the left and a value on the right.
 * Optional copy button, optional visibility toggle.
 */
export default function DataField({
 label,
 value,
 copyable = false,
 concealable = false,
}: {
 label: string;
 value: string;
 /** Show copy button */
 copyable?: boolean;
 /** Show eye toggle to hide/reveal value */
 concealable?: boolean;
}) {
 const [visible, setVisible] = useState(!concealable);

 const copy = useCallback(() => {
 navigator.clipboard.writeText(value).then(
 () => notifySuccess('Copied'),
 () => notifyError('Failed to copy'),
 );
 }, [value]);

 return (
 <div className="flex items-center justify-between gap-2 rounded-md border border-border/20 bg-surface-2/20 px-2.5 py-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/40">
 {label}
 </span>
 <div className="flex items-center gap-1">
 <code className="text-[11px] tabular-nums font-mono text-foreground">
 {concealable && !visible ? '••••••••' : value || '—'}
 </code>
 {concealable && (
 <button
 type="button"
 onClick={() => setVisible(!visible)}
 className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-foreground"
 >
 {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
 </button>
 )}
 {copyable && (
 <button
 type="button"
 onClick={copy}
 className="rounded p-0.5 text-muted-foreground/30 transition-colors hover:text-foreground"
 title="Copy"
 >
 <Copy className="h-3 w-3" />
 </button>
 )}
 </div>
 </div>
 );
}
