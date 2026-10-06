import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import { templatesApi } from '../services/api/templates';
import { reportSystemError } from '../services/api/systemErrors';

export function useTemplates() {
  return useQuery({
    queryKey: qk.templates(),
    queryFn: templatesApi.list,
    staleTime: 5 * 60 * 1000,
    // Admin SSE 403s for template.read-only users; 60s safety poll (U12).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useTemplate(templateId?: string) {
  return useQuery({
    queryKey: qk.template(templateId!),
    queryFn: () => {
      if (templateId) return templatesApi.get(templateId);
      reportSystemError({ level: 'error', component: 'useTemplates', message: 'missing template id', metadata: { context: 'query' } });
      return Promise.reject(new Error('missing template id'));
    },
    enabled: Boolean(templateId),
    staleTime: 5 * 60 * 1000,
    // Admin SSE 403s for template.read-only users; 60s safety poll (U12).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
