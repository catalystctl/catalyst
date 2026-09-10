import { beforeEach, describe, expect, it } from 'vitest';
import {
  useDownloadStore,
  resetDownloadStoreForTests,
} from './downloadStore';

describe('downloadStore', () => {
  beforeEach(() => {
    resetDownloadStoreForTests();
  });

  it('begins a session with pending files', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/plugins/a.jar', name: 'a.jar', total: 100 },
      { path: '/plugins/b.jar', name: 'b.jar', total: 200 },
    ]);
    const session = useDownloadStore.getState().sessions.find((s) => s.id === id);
    expect(session).toBeDefined();
    expect(session?.status).toBe('active');
    expect(session?.files).toHaveLength(2);
    expect(session?.files[0]).toMatchObject({ loaded: 0, progress: -1, status: 'active' });
  });

  it('tracks byte-level progress and clamps percentage below 100 while active', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 1000 },
    ]);
    useDownloadStore.getState().setFileProgress(id, 0, 500, 1000);
    const file = useDownloadStore.getState().sessions[0].files[0];
    expect(file.loaded).toBe(500);
    expect(file.progress).toBe(50);
  });

  it('marks files done at 100% and completes the session when all files finish', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
      { path: '/b.jar', name: 'b.jar', total: 100 },
    ]);
    useDownloadStore.getState().setFileDone(id, 0);
    expect(useDownloadStore.getState().sessions[0].status).toBe('active');
    useDownloadStore.getState().setFileDone(id, 1);
    const session = useDownloadStore.getState().sessions[0];
    expect(session.status).toBe('done');
    expect(session.files.every((f) => f.status === 'done' && f.progress === 100)).toBe(true);
  });

  it('marks the session as errored when a file errors', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
    ]);
    useDownloadStore.getState().setFileError(id, 0, 'Download failed: 404');
    const session = useDownloadStore.getState().sessions[0];
    expect(session.status).toBe('error');
    expect(session.files[0].errorMessage).toBe('Download failed: 404');
  });

  it('cancelSession aborts the registered controller', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
    ]);
    const controller = new AbortController();
    useDownloadStore.getState().registerAbort(id, controller);
    useDownloadStore.getState().cancelSession(id);
    expect(controller.signal.aborted).toBe(true);
  });

  it('dismissSession removes the session', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
    ]);
    useDownloadStore.getState().dismissSession(id);
    expect(useDownloadStore.getState().sessions).toHaveLength(0);
  });

  it('markSessionDone force-finishes still-active files', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
    ]);
    useDownloadStore.getState().markSessionDone(id);
    const session = useDownloadStore.getState().sessions[0];
    expect(session.status).toBe('done');
    expect(session.files[0].status).toBe('done');
  });

  it('canceled status is sticky against later file-level updates', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
    ]);
    useDownloadStore.getState().markSessionCanceled(id);
    useDownloadStore.getState().setFileError(id, 0, 'Download aborted');
    const session = useDownloadStore.getState().sessions[0];
    expect(session.status).toBe('canceled');
  });
});
