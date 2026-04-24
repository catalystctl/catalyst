import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { templatesApi } from '../services/api/templates';
import { reportSystemError } from '../services/api/systemErrors';

export function useTemplates() {
  return useQuery({
    queryKey: qk.templates(),
    queryFn: templatesApi.list,
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
  });
}
