/**
 * Create a node allocation without leaving the create-server form (audit D10 /
 * D-shell dead end).
 *
 * "New" / "Create one →" used to open `/admin/nodes/:id/allocations` in a NEW
 * TAB. That stranded the half-filled create form behind a new tab (and the
 * second tab is one of the triggers of the multi-tab realtime bug), and the
 * operator had to come back and pick the new port by hand anyway.
 *
 * This inline popover defaults the IP to `0.0.0.0`, suggests the next free port
 * from the node's existing allocations, creates the range through
 * `nodesApi.createAllocations`, and reports back so the caller can refresh its
 * allocation list and auto-select the new entry.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { nodesApi } from '../../services/api/nodes';
import type { NodeAllocation } from '../../types/node';
import { notifySuccess } from '../../utils/notify';
import { getLocalizedErrorMessage } from '../../i18n/api-errors';
import { cn } from '@/lib/utils';
import { suggestNextFreePort } from './createAllocationPorts';

const fieldClass =
  'h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';
const monoFieldClass = `${fieldClass} font-mono tabular-nums`;

type Props = {
  nodeId: string;
  /** Every allocation already on the node, for the next-free-port suggestion. */
  allocations: Array<Pick<NodeAllocation, 'port'>>;
  /** Called after a successful create: refresh the list and select the new one. */
  onCreated: (created: { port: number; ip: string }) => void;
  /** `New` (default) or a bare `Create one →` link inside a hint line. */
  variant?: 'button' | 'link';
  disabled?: boolean;
  className?: string;
};

export default function CreateAllocationInline({
  nodeId,
  allocations,
  onCreated,
  variant = 'button',
  disabled = false,
  className,
}: Props) {
  const { t } = useTranslation('servers');
  const [open, setOpen] = useState(false);
  const suggestedPort = useMemo(() => suggestNextFreePort(allocations), [allocations]);
  const [ip, setIp] = useState('0.0.0.0');
  const [ports, setPorts] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portValue = ports.trim() === '' ? String(suggestedPort) : ports.trim();
  const firstPort = Number(portValue.split(/[-,]/)[0]);
  const invalid = !ip.trim() || !Number.isFinite(firstPort) || firstPort < 1 || firstPort > 65535;

  const submit = async () => {
    if (invalid || pending) return;
    setPending(true);
    setError(null);
    try {
      await nodesApi.createAllocations(nodeId, { ip: ip.trim(), ports: portValue });
      notifySuccess(t('createServer.network.allocationCreated', { ports: portValue }));
      onCreated({ ip: ip.trim(), port: firstPort });
      setPorts('');
      setOpen(false);
    } catch (err) {
      setError(getLocalizedErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        {variant === 'link' ? (
          <button
            type="button"
            disabled={disabled}
            className={cn('font-medium text-primary hover:underline disabled:opacity-50', className)}
          >
            {t('fields.createOne')}
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            title={t('createServer.network.createAllocationsHint')}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border/60 px-2.5 text-mini text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50',
              className,
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('createServer.network.newAllocation')}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2.5">
        <div className="space-y-1">
          <p className="text-mini font-medium text-foreground">
            {t('createServer.network.inlineAllocationTitle')}
          </p>
          <p className="text-micro text-muted-foreground">
            {t('createServer.network.inlineAllocationHint')}
          </p>
        </div>
        <label className="block space-y-1">
          <span className="type-overline">{t('createServer.network.allocationIp')}</span>
          <input
            className={monoFieldClass}
            value={ip}
            onChange={(event) => setIp(event.target.value)}
            placeholder="0.0.0.0"
            aria-label={t('createServer.network.allocationIp')}
          />
        </label>
        <label className="block space-y-1">
          <span className="type-overline">{t('createServer.network.allocationPorts')}</span>
          <input
            className={monoFieldClass}
            value={ports}
            onChange={(event) => setPorts(event.target.value)}
            placeholder={String(suggestedPort)}
            aria-label={t('createServer.network.allocationPorts')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <p className="text-micro text-muted-foreground">
            {t('createServer.network.nextFreePortHint', { port: suggestedPort })}
          </p>
        </label>
        {error ? (
          <p role="alert" className="text-micro text-warning">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-0.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-sm px-2 text-mini"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            size="sm"
            className="h-7 rounded-sm px-2 text-mini"
            onClick={() => void submit()}
            disabled={pending || invalid}
          >
            {pending ? t('createServer.network.creatingAllocation') : t('createServer.network.createAllocation')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}