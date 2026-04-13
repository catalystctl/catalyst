import { useState } from 'react';
import { Copy, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useCreateApiKey } from '../../hooks/useApiKeys';
import { CreateApiKeyRequest } from '../../services/apiKeys';
import { toast } from 'sonner';

interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateApiKeyDialog({ open, onOpenChange }: CreateApiKeyDialogProps) {
  const createApiKey = useCreateApiKey();
  const [formData, setFormData] = useState<CreateApiKeyRequest>({
    name: '',
    expiresIn: 7776000, // 90 days default
    rateLimitMax: 100,
    rateLimitTimeWindow: 60000, // 1 minute
  });
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Please enter a name for the API key');
      return;
    }

    try {
      // Remove expiresIn if set to 0 (never expires)
      const payload = { ...formData };
      if (payload.expiresIn === 0) {
        delete payload.expiresIn;
      }
      
      const result = await createApiKey.mutateAsync(payload);
      setCreatedKey(result.key);
    } catch (error) {
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
    setFormData({
      name: '',
      expiresIn: 7776000,
      rateLimitMax: 100,
      rateLimitTimeWindow: 60000,
    });
    setCreatedKey(null);
    setCopied(false);
    onOpenChange(false);
  };

  const expirationOptions = [
    { label: 'Never expires', value: 0 },
    { label: '7 days', value: 604800 },
    { label: '30 days', value: 2592000 },
    { label: '90 days (recommended)', value: 7776000 },
    { label: '180 days', value: 15552000 },
    { label: '1 year', value: 31536000 },
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-surface-1 rounded-xl p-6 max-w-xl w-full mx-4 shadow-xl">
        {!createdKey ? (
          <>
            <h2 className="text-xl font-semibold mb-2 text-foreground dark:text-zinc-100">
              Create API Key
            </h2>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground mb-6">
              Generate a new API key for automated access to Catalyst
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground dark:text-zinc-100">
                  Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g., Billing System Integration"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-surface-1 text-foreground dark:text-zinc-100"
                  required
                />
                <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                  A descriptive name to identify this API key
                </p>
              </div>

              {/* Expiration */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground dark:text-zinc-100">
                  Expiration
                </label>
                <select
                  value={formData.expiresIn}
                  onChange={(e) =>
                    setFormData({ ...formData, expiresIn: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-surface-1 text-foreground dark:text-zinc-100"
                >
                  {expirationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Rate Limit */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground dark:text-zinc-100">
                  Rate Limit
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={formData.rateLimitMax}
                    onChange={(e) =>
                      setFormData({ ...formData, rateLimitMax: Number(e.target.value) })
                    }
                    className="w-32 px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-surface-1 text-foreground dark:text-zinc-100"
                  />
                  <span className="text-sm text-muted-foreground dark:text-muted-foreground">
                    requests per minute
                  </span>
                </div>
                <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                  Maximum number of requests allowed per minute
                </p>
              </div>

              <div className="flex gap-3 justify-end pt-4">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-semibold text-foreground dark:text-zinc-300 hover:bg-surface-2 dark:hover:bg-surface-2 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createApiKey.isPending}
                  className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded transition-colors disabled:opacity-50"
                >
                  {createApiKey.isPending ? 'Creating...' : 'Create API Key'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold mb-2 text-foreground dark:text-zinc-100">
              API Key Created
            </h2>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground mb-6">
              Copy your API key now. For security reasons, it won't be shown again.
            </p>

            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5" />
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  Make sure to copy your API key now. You won't be able to see it again!
                </p>
              </div>

              {/* API Key Display */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground dark:text-zinc-100">
                  Your API Key
                </label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={createdKey}
                    className="flex-1 px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-surface-1 text-foreground dark:text-zinc-100 font-mono text-sm"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    onClick={handleCopy}
                    className="px-4 py-2 border border-border dark:border-border hover:bg-surface-2 dark:hover:bg-surface-2 rounded-lg transition-colors"
                  >
                    {copied ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-surface-2 dark:bg-surface-2 p-4 rounded-lg">
                <h4 className="font-semibold mb-2 text-foreground dark:text-zinc-100 text-sm">
                  Usage Example
                </h4>
                <pre className="text-xs overflow-x-auto text-foreground dark:text-zinc-300">
                  <code>{`curl -H "x-api-key: ${createdKey}" \\
  ${window.location.origin}/api/servers`}</code>
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded transition-colors"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
