import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { templatesApi } from '../services/api/templates';

export function useTemplates() {
  return useQuery({
    queryKey: qk.templates(),
    queryFn: templatesApi.list,
  });
}

export function useTemplate(templateId?: string) {
  return useQuery({
    queryKey: qk.template(templateId!),
    queryFn: () =>
      templateId ? templatesApi.get(templateId) : Promise.reject(new Error('missing template id')),
    enabled: Boolean(templateId),
  });
}
