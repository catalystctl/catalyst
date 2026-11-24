import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import i18n from '../../i18n';

const { templateUpdate, permissions, templateState, setQueryData, invalidateQueries } = vi.hoisted(() => ({
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  templateUpdate: vi.fn(),
  permissions: { current: ['template.update'] as string[] },
  templateState: {
    current: {
      id: 'template-1',
      name: 'Paper',
      author: 'catalystctl',
      version: '1.0.0',
      image: 'itzg/minecraft-server',
      startup: 'java -jar server.jar',
      stopCommand: 'stop',
      sendSignalTo: 'SIGTERM',
      description: 'Fast Minecraft',
      supportedPorts: [25565],
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 2,
      allocatedDiskMb: 10240,
      variables: [
        { name: 'SERVER_MEMORY', default: '1024', required: true, input: 'number' as const },
        { name: 'GAMEMODE', default: 'survival', required: false, input: 'select' as const, rules: ['in:survival,creative'] },
      ],
    },
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ templateId: 'template-1' }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (select: (state: { user: { permissions: string[] } }) => unknown) =>
    select({ user: { permissions: permissions.current } }),
}));
vi.mock('../../hooks/useTemplates', () => ({
  useTemplate: () => ({ data: templateState.current, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('../../services/api/templates', () => ({
  templatesApi: { update: (...args: unknown[]) => templateUpdate(...args) },
}));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('../../lib/queryClient', () => ({ queryClient: { setQueryData, invalidateQueries } }));
vi.mock('../../components/templates/TemplateEditModal', () => ({ default: () => null }));
vi.mock('../../components/templates/TemplateDeleteDialog', () => ({ default: () => null }));
vi.mock('@/csync', () => ({
  useMutation: (options: {
    mutationFn: (vars: unknown) => Promise<unknown>;
    onSuccess?: (result: unknown) => void;
    onError?: (error: unknown) => void;
    onSettled?: () => void;
  }) => {
    const run = (vars: unknown) =>
      options
        .mutationFn(vars)
        .then(options.onSuccess, options.onError)
        .finally(options.onSettled);
    return { isPending: false, variables: undefined, mutate: run, mutateAsync: run };
  },
}));
// The page chrome (deck panels, data fields) is not what this test is about.
vi.mock('../../components/servers/tabs/ServerTabCard', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../components/servers/tabs/SectionHeader', () => ({
  default: ({ title }: { title: string }) => <h2>{title}</h2>,
}));
vi.mock('../../components/servers/tabs/DataField', () => ({ default: () => null }));
vi.mock('../../components/servers/tabs/TabLoadingState', () => ({ default: () => null }));
vi.mock('../../components/servers/tabs/TabErrorState', () => ({ default: () => null }));

import TemplateDetailsPage from './TemplateDetailsPage';

const tt = (key: string) => i18n.t(key, { ns: 'templates' });

describe('TemplateDetailsPage inline variable edit (D18)', () => {
  beforeEach(() => {
    templateUpdate.mockReset().mockResolvedValue({
      ...templateState.current,
      variables: [
        { name: 'SERVER_MEMORY', default: '2048', required: true, input: 'number' },
        templateState.current.variables[1],
      ],
    });
    permissions.current = ['template.update'];
  });
  afterEach(cleanup);

  it('PUTs the whole variables array with only the edited entry changed', async () => {
    render(<TemplateDetailsPage />);

    fireEvent.click(screen.getAllByRole('button', { name: tt('variables.edit') })[0]);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2048' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('actions.save', { ns: 'common' }) }));

    await waitFor(() => expect(templateUpdate).toHaveBeenCalledTimes(1));
    const [templateId, payload] = templateUpdate.mock.calls[0];
    expect(templateId).toBe('template-1');
    expect(payload).toEqual({
      variables: [
        { name: 'SERVER_MEMORY', default: '2048', required: true, input: 'number' },
        { name: 'GAMEMODE', default: 'survival', required: false, input: 'select', rules: ['in:survival,creative'] },
      ],
    });
    // Only the variables field is sent — the rest of the template is untouched.
    expect(Object.keys(payload)).toEqual(['variables']);
  });

  it('stays read-only for a user without template.update', () => {
    permissions.current = ['template.read'];
    render(<TemplateDetailsPage />);
    expect(screen.queryByRole('button', { name: tt('variables.edit') })).not.toBeInTheDocument();
  });
});
