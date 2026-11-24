import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import i18n from '../../i18n';

// `vi.mock` factories are hoisted above the module body, so the spies they
// close over have to be hoisted too.
const { templateCreate, nestCreate, invalidateQueries, nests } = vi.hoisted(() => ({
  templateCreate: vi.fn(),
  nestCreate: vi.fn(),
  invalidateQueries: vi.fn(),
  // Mutable so a test can start from an empty nest list (the D13 inline path).
  nests: { current: [] as { id: string; name: string }[] },
}));

vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries } }));
vi.mock('../../services/api/templates', () => ({
  templatesApi: {
    create: (...args: unknown[]) => templateCreate(...args),
    importPterodactylBatch: vi.fn(),
  },
}));
vi.mock('../../services/api/nests', () => ({
  nestsApi: {
    list: () => Promise.resolve(nests.current),
    create: (...args: unknown[]) => nestCreate(...args),
  },
}));
vi.mock('../../services/api/systemErrors', () => ({ reportSystemError: vi.fn() }));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('../../components/ui/combobox', () => ({
  default: ({ value, onChange, options, placeholder }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: ReactNode }[];
    placeholder?: string;
  }) => (
    <button
      type="button"
      role="combobox"
      aria-label={placeholder}
      onClick={() => options[0] && onChange(options[0].value)}
    >
      {value}
    </button>
  ),
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock('@/csync', () => ({
  useQuery: () => ({ data: nests.current, isLoading: false }),
  useMutation: (options: {
    mutationFn: (vars: unknown) => Promise<unknown>;
    onSuccess?: (result: unknown) => void;
    onError?: (error: unknown) => void;
    onSettled?: () => void;
  }) => ({
    isPending: false,
    variables: undefined,
    mutate: (vars: unknown) => {
      options
        .mutationFn(vars)
        .then(options.onSuccess, options.onError)
        .finally(options.onSettled);
    },
    mutateAsync: (vars: unknown) => options.mutationFn(vars),
  }),
}));

import TemplateCreateModal from './TemplateCreateModal';

const t = (key: string) => i18n.t(key, { ns: 'templates' });

/** An egg whose Catalyst `ports` extension declares game + query ports. */
const eggWithPorts = {
  meta: { version: 'PTDL_v2' },
  name: 'Enshrouded',
  author: 'catalystctl',
  description: 'Survival RPG',
  docker_images: { java: 'itzg/en shrounded:latest' },
  startup: './enshrouded_server --port $SERVER_PORT',
  config: { stop: '^C' },
  ports: [15637, 15638],
  variables: [
    {
      name: 'Server Port',
      env_variable: 'SERVER_PORT',
      default_value: '15637',
      rules: 'required|integer|between:1024,65535',
    },
  ],
};

/** Upload an egg through the hidden file input, as the "Choose file" path does. */
function uploadEgg(egg: unknown) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([JSON.stringify(egg)], 'egg.json', { type: 'application/json' });
  // jsdom's File.text() is what handleImportFile awaits for multi-file; the
  // single-file branch uses FileReader, which jsdom implements over this blob.
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

/** Wait for the import to populate the ports field. */
async function portsField() {
  return waitFor(() => {
    const label = screen.getByText(t('form.ports'));
    const field = label.parentElement?.querySelector('input');
    if (!field) throw new Error('ports field missing');
    return field as HTMLInputElement;
  });
}

describe('TemplateCreateModal egg import (D12)', () => {
  beforeEach(() => {
    templateCreate.mockReset().mockResolvedValue({ id: 'created-1' });
    nestCreate.mockReset().mockResolvedValue({ id: 'nest-9', name: 'Minecraft' });
    invalidateQueries.mockReset();
    nests.current = [{ id: 'nest-1', name: 'Minecraft' }];
  });
  afterEach(cleanup);

  it('seeds every port an egg declares in its `ports` extension', async () => {
    render(<TemplateCreateModal />);
    fireEvent.click(screen.getByRole('button', { name: t('create.newTemplate') }));
    uploadEgg(eggWithPorts);

    const ports = await portsField();
    await waitFor(() => expect(ports.value).toBe('15637, 15638'));
  });

  it('offers one-click "Import & create" when the imported egg needs no edits', async () => {
    render(<TemplateCreateModal />);
    fireEvent.click(screen.getByRole('button', { name: t('create.newTemplate') }));
    uploadEgg(eggWithPorts);

    const quickCreate = await screen.findByRole('button', { name: new RegExp(t('create.importAndCreate')) });
    fireEvent.click(quickCreate);

    await waitFor(() => expect(templateCreate).toHaveBeenCalledTimes(1));
    const payload = templateCreate.mock.calls[0][0];
    expect(payload.name).toBe('Enshrouded');
    expect(payload.supportedPorts).toEqual([15637, 15638]);
    // The one-click path must not need a second press of the regular submit.
    expect(screen.queryByRole('button', { name: new RegExp(t('create.importAndCreate')) }))
      .not.toBeInTheDocument();
  });

  it('withholds one-click create and keeps the review form when the egg is incomplete', async () => {
    render(<TemplateCreateModal />);
    fireEvent.click(screen.getByRole('button', { name: t('create.newTemplate') }));
    uploadEgg({ meta: { version: 'PTDL_v2' }, name: 'Broken egg', variables: [] });

    // Name present, everything else (author/version/image/startup) missing.
    await waitFor(() => expect(screen.getByDisplayValue('Broken egg')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: new RegExp(t('create.importAndCreate')) }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('create.submit') })).toBeDisabled();
  });
});

describe('TemplateCreateModal inline nest create (D13)', () => {
  beforeEach(() => {
    templateCreate.mockReset().mockResolvedValue({ id: 'created-1' });
    nestCreate.mockReset().mockResolvedValue({ id: 'nest-9', name: 'Vanilla' });
    invalidateQueries.mockReset();
    nests.current = [];
  });
  afterEach(cleanup);

  it('creates a nest from the inline field and selects it without leaving the dialog', async () => {
    render(<TemplateCreateModal />);
    fireEvent.click(screen.getByRole('button', { name: t('create.newTemplate') }));

    // No nests exist, so the inline creator is the only way forward.
    const nameField = screen.getByPlaceholderText(t('create.nestNamePlaceholder'));
    fireEvent.change(nameField, { target: { value: 'Vanilla' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('actions.create', { ns: 'common' }) }));

    await waitFor(() => expect(nestCreate).toHaveBeenCalledWith({ name: 'Vanilla' }));
    // The nests manager is NOT opened on top of this dialog any more.
    expect(screen.getByRole('heading', { name: t('create.titleStep2') })).toBeInTheDocument();
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['nests'] }));
  });

  it('does not submit an empty nest name', () => {
    render(<TemplateCreateModal />);
    fireEvent.click(screen.getByRole('button', { name: t('create.newTemplate') }));
    expect(screen.getByRole('button', { name: i18n.t('actions.create', { ns: 'common' }) })).toBeDisabled();
    expect(nestCreate).not.toHaveBeenCalled();
  });

  it('keeps the template payload when a nest is created inline', async () => {
    render(<TemplateCreateModal />);
    fireEvent.click(screen.getByRole('button', { name: t('create.newTemplate') }));
    fireEvent.change(screen.getByPlaceholderText('Minecraft Paper'), { target: { value: 'Paper' } });
    fireEvent.change(screen.getByPlaceholderText(t('create.nestNamePlaceholder')), {
      target: { value: 'Vanilla' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('actions.create', { ns: 'common' }) }));
    await waitFor(() => expect(nestCreate).toHaveBeenCalled());
    // The typed template name survives the nest creation.
    expect(screen.getByDisplayValue('Paper')).toBeInTheDocument();
  });
});
