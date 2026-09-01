import { beforeEach, describe, expect, it } from 'vitest';
import {
  useUploadStore,
  resetUploadStoreForTests,
} from './uploadStore';

describe('uploadStore', () => {
  beforeEach(() => {
    resetUploadStoreForTests();
  });

  it('begins a session with pending files', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/plugins/a.jar', name: 'a.jar', total: 100 },
      { path: '/plugins/b.jar', name: 'b.jar', total: 200 },
    ]);
    const session = useUploadStore.getState().sessions.find((s) => s.id === id);
    expect(session).toBeDefined();
    expect(session?.status).toBe('active');
    expect(session?.files).toHaveLength(2);
    expect(session?.files[0]).toMatchObject({ loaded: 0, progress: -1, status: 'active' });
  });

  it('tracks byte-level progress and clamps percentage below 100 while active', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 1000 },
    ]);
    useUploadStore.getState().setFileProgress(id, 0, 500, 1000);
    const file = useUploadStore.getState().sessions[0].files[0];
    expect(file.loaded).toBe(500);
    expect(file.progress).toBe(50);
  });

  it('marks files done at 100% and completes the session when all files finish', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
      { path: '/b.jar', name: 'b.jar', total: 100 },
    ]);
    useUploadStore.getState().setFileDone(id, 0);
    expect(useUploadStore.getState().sessions[0].status).toBe('active');
    useUploadStore.getState().setFileDone(id, 1);
    const session = useUploadStore.getState().sessions[0];
    expect(session.status).toBe('done');
    expect(session.files.every((f) => f.status === 'done' && f.progress === 100)).toBe(true);
  });

  it('marks the session as errored when a file errors', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
    ]);
    useUploadStore.getState().setFileError(id, 0, 'Upload failed: 413');
    const session = useUploadStore.getState().sessions[0];
    expect(session.status).toBe('error');
    expect(session.files[0].errorMessage).toBe('Upload failed: 413');
  });

  it('cancelSession aborts the registered controller', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
    ]);
    const controller = new AbortController();
    useUploadStore.getState().registerAbort(id, controller);
    useUploadStore.getState().cancelSession(id);
    expect(controller.signal.aborted).toBe(true);
  });

  it('dismissSession removes the session', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
    ]);
    useUploadStore.getState().dismissSession(id);
    expect(useUploadStore.getState().sessions).toHaveLength(0);
  });

  it('markSessionDone force-finishes still-active files', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
    ]);
    useUploadStore.getState().markSessionDone(id);
    const session = useUploadStore.getState().sessions[0];
    expect(session.status).toBe('done');
    expect(session.files[0].status).toBe('done');
  });

  it('canceled status is sticky against later file-level updates', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 100 },
    ]);
    useUploadStore.getState().markSessionCanceled(id);
    useUploadStore.getState().setFileError(id, 0, 'Upload aborted');
    const session = useUploadStore.getState().sessions[0];
    expect(session.status).toBe('canceled');
  });
});
