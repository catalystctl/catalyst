import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ModpackInstallPanel from './ModpackInstallPanel';
import type { ModpackInstallJob } from '../../../services/api/modpacks';

const installUpload = vi.fn();
const installUrl = vi.fn();
const job = vi.fn();

vi.mock('../../../services/api/modpacks', () => ({
  modpackApi: {
    installUpload: (...args: unknown[]) => installUpload(...args),
    installUrl: (...args: unknown[]) => installUrl(...args),
    job: (...args: unknown[]) => job(...args),
  },
}));

const notifySuccess = vi.fn();
const notifyError = vi.fn();
vi.mock('../../../utils/notify', () => ({
  notifySuccess: (...args: unknown[]) => notifySuccess(...args),
  notifyError: (...args: unknown[]) => notifyError(...args),
}));

function makeJob(overrides: Partial<ModpackInstallJob> = {}): ModpackInstallJob {
  return {
    id: 'job-1',
    status: 'running',
    progress: { phase: 'extracting', completed: 0, total: 1 },
    result: null,
    error: null,
    code: null,
    filename: 'pack.mrpack',
    ...overrides,
  };
}

function pickFile() {
  const input = screen.getByLabelText('Modpack archive') as HTMLInputElement;
  const file = new File(['zip-bytes'], 'pack.mrpack', { type: 'application/zip' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  installUpload.mockReset();
  installUrl.mockReset();
  job.mockReset();
  notifySuccess.mockReset();
  notifyError.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ModpackInstallPanel', () => {
  it('offers file and URL sources and blocks install until one is chosen', () => {
    render(<ModpackInstallPanel serverId="srv-1" />);

    expect(screen.getByText('Install a modpack')).toBeInTheDocument();
    expect(screen.getByLabelText('Modpack archive')).toBeInTheDocument();
    expect(screen.getByLabelText('Or install from a URL')).toBeInTheDocument();

    const install = screen.getByRole('button', { name: /Install modpack/ });
    expect(install).toBeDisabled();
  });

  it('accepts the archive formats the backend can unpack', () => {
    render(<ModpackInstallPanel serverId="srv-1" />);
    const input = screen.getByLabelText('Modpack archive') as HTMLInputElement;
    // .mrpack is a zip; the rest are tar variants or plain zips.
    for (const extension of ['.zip', '.mrpack', '.mr', '.tar', '.tar.gz', '.tar.xz']) {
      expect(input.accept).toContain(extension);
    }
  });

  it('uploads the chosen archive and reports progress', async () => {
    installUpload.mockResolvedValue(makeJob());
    render(<ModpackInstallPanel serverId="srv-1" />);

    const file = pickFile();
    fireEvent.click(screen.getByRole('button', { name: /Install modpack/ }));

    await waitFor(() => expect(installUpload).toHaveBeenCalledWith('srv-1', file, { path: undefined }));
    expect(await screen.findByText('Extracting archive')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
  });

  it('polls to completion and summarises what was installed', async () => {
    installUpload.mockResolvedValue(makeJob());
    job.mockResolvedValue(
      makeJob({
        status: 'completed',
        progress: { phase: 'finalizing', completed: 1, total: 1 },
        result: {
          format: 'mrpack',
          container: 'zip',
          name: 'My Pack',
          version: '1.0.0',
          gameVersion: '1.20.1',
          modLoader: 'fabric',
          installedFiles: ['mods/a.jar', 'mods/b.jar'],
          installedOverrides: 7,
          skipped: [{ path: 'mods/sodium.jar', reason: 'client-only' }],
          warnings: [],
        },
      }),
    );

    render(<ModpackInstallPanel serverId="srv-1" />);
    pickFile();
    fireEvent.click(screen.getByRole('button', { name: /Install modpack/ }));

    await waitFor(() => expect(screen.getByText('Extracting archive')).toBeInTheDocument());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });

    await waitFor(() => expect(job).toHaveBeenCalledWith('srv-1', 'job-1'));
    expect(await screen.findByText('Installed')).toBeInTheDocument();
    expect(screen.getByText('mrpack')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(notifySuccess).toHaveBeenCalledWith('pack.mrpack installed');
  });

  it('surfaces a failed job as an error instead of a silent stall', async () => {
    installUpload.mockResolvedValue(makeJob());
    job.mockResolvedValue(
      makeJob({
        status: 'failed',
        error: 'Unsupported modpack archive "pack.7z"',
        code: 'MODPACK_FORMAT_UNSUPPORTED',
      }),
    );

    render(<ModpackInstallPanel serverId="srv-1" />);
    pickFile();
    fireEvent.click(screen.getByRole('button', { name: /Install modpack/ }));

    await waitFor(() => expect(screen.getByText('Extracting archive')).toBeInTheDocument());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    // The backend's specific message wins over the generic translated code.
    expect(screen.getByText(/Unsupported modpack archive/)).toBeInTheDocument();
  });

  it('installs from a URL when no file is chosen', async () => {
    installUrl.mockResolvedValue(makeJob());
    render(<ModpackInstallPanel serverId="srv-1" />);

    fireEvent.change(screen.getByLabelText('Or install from a URL'), {
      target: { value: 'https://example.com/pack.tar.gz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Install modpack/ }));

    await waitFor(() =>
      expect(installUrl).toHaveBeenCalledWith('srv-1', 'https://example.com/pack.tar.gz', {
        path: undefined,
      }),
    );
  });

  it('stays disabled for a whitespace-only URL', () => {
    render(<ModpackInstallPanel serverId="srv-1" />);
    fireEvent.change(screen.getByLabelText('Or install from a URL'), {
      target: { value: '   ' },
    });

    const install = screen.getByRole('button', { name: /Install modpack/ });
    expect(install).toBeDisabled();
    expect(installUpload).not.toHaveBeenCalled();
    expect(installUrl).not.toHaveBeenCalled();
  });

  it('sends the configured install directory', async () => {
    installUpload.mockResolvedValue(makeJob());
    render(<ModpackInstallPanel serverId="srv-1" defaultPath="/instance" />);

    const file = pickFile();
    fireEvent.click(screen.getByRole('button', { name: /Install modpack/ }));

    await waitFor(() =>
      expect(installUpload).toHaveBeenCalledWith('srv-1', file, { path: '/instance' }),
    );
  });
});
