import { create } from 'zustand';

/**
 * Tracks in-flight file uploads so progress stays visible even when the
 * upload modal closes or the user navigates elsewhere in the app.
 *
 * A "session" groups one user action (a drop or a modal submit). Sessions
 * from drag-and-drop are global (visible anywhere in the app); modal
 * uploads are scoped per server so unrelated pages aren't cluttered.
 */
export interface UploadFileState {
  /** Path of the file on the server (target dir + name), used for display. */
  path: string;
  name: string;
  /** Bytes sent so far. */
  loaded: number;
  /** Total bytes, when the browser reports it as computable. */
  total?: number;
  /** 0-100, -1 while waiting for the first progress event. */
  progress: number;
  status: 'active' | 'done' | 'error';
  errorMessage?: string;
}

export interface UploadSession {
  id: string;
  createdAt: number;
  /** When the session reached a terminal state (done/error/canceled). */
  finishedAt?: number;
  files: UploadFileState[];
  status: 'active' | 'done' | 'error' | 'canceled';
}

interface UploadState {
  sessions: UploadSession[];
  beginSession: (
    files: Array<Pick<UploadFileState, 'path' | 'name' | 'total'>>,
  ) => string;
  setFileProgress: (sessionId: string, fileIndex: number, loaded: number, total?: number) => void;
  setFileDone: (sessionId: string, fileIndex: number) => void;
  setFileError: (sessionId: string, fileIndex: number, message: string) => void;
  /** Force-finishes any still-active files (e.g. caller resolved without per-file events). */
  markSessionDone: (sessionId: string) => void;
  /** Marks a session canceled (user abort). Sticky: later file errors don't override it. */
  markSessionCanceled: (sessionId: string) => void;
  dismissSession: (sessionId: string) => void;
  cancelSession: (sessionId: string) => void;
  registerAbort: (sessionId: string, controller: AbortController) => void;
}

const MAX_SESSIONS = 20;
/** How long completed sessions stay visible before auto-dismissal. */
export const COMPLETED_SESSION_TTL_MS = 5000;

/**
 * Abort controllers for in-flight uploads, keyed by session id. Kept in a
 * module-level map (outside React state) so cancels never trigger re-renders.
 */
const abortRegistry = new Map<string, AbortController>();

let sessionCounter = 0;
const nextSessionId = () => {
  sessionCounter += 1;
  return `upload-${Date.now()}-${sessionCounter}`;
};

/** Derives coarse session status from per-file statuses. */
const recomputeSessionStatus = (session: UploadSession): UploadSession['status'] => {
  if (session.status === 'canceled') return 'canceled';
  if (session.files.some((f) => f.status === 'active')) return 'active';
  return session.files.some((f) => f.status === 'error') ? 'error' : 'done';
};

const mapSession = (
  sessions: UploadSession[],
  sessionId: string,
  fn: (session: UploadSession) => UploadSession,
): UploadSession[] =>
  sessions.map((session) =>
    session.id === sessionId
      ? (() => {
          const next = fn(session);
          // Stamp completion time the first time the session turns terminal
          // so finished sessions get a full TTL before auto-dismissal.
          const becameTerminal =
            next.status !== 'active' && session.status === 'active' && !next.finishedAt;
          return becameTerminal ? { ...next, finishedAt: Date.now() } : next;
        })()
      : session,
  );

export const useUploadStore = create<UploadState>((set) => ({
  sessions: [],

  beginSession: (files) => {
    const id = nextSessionId();
    const session: UploadSession = {
      id,
      createdAt: Date.now(),
      status: 'active',
      files: files.map((f) => ({
        ...f,
        loaded: 0,
        progress: f.total === 0 ? 100 : -1,
        status: 'active',
      })),
    };
    set((state) => ({
      sessions: [...state.sessions.slice(-(MAX_SESSIONS - 1)), session],
    }));
    return id;
  },

  setFileProgress: (sessionId, fileIndex, loaded, total) => {
    set((state) => ({
      sessions: mapSession(state.sessions, sessionId, (session) => ({
        ...session,
        files: session.files.map((file, idx) => {
          if (idx !== fileIndex) return file;
          const safeTotal = total ?? file.total;
          const pct =
            safeTotal && safeTotal > 0
              ? Math.min(99, Math.round((loaded / safeTotal) * 100))
              : file.progress;
          return { ...file, loaded, total: safeTotal, progress: pct };
        }),
      })),
    }));
  },

  setFileDone: (sessionId, fileIndex) => {
    set((state) => ({
      sessions: mapSession(state.sessions, sessionId, (session) => {
        const files = session.files.map((file, idx) =>
          idx === fileIndex
            ? { ...file, loaded: file.total ?? file.loaded, progress: 100, status: 'done' as const }
            : file,
        );
        const next = { ...session, files };
        return { ...next, status: recomputeSessionStatus(next) };
      }),
    }));
  },

  setFileError: (sessionId, fileIndex, message) => {
    set((state) => ({
      sessions: mapSession(state.sessions, sessionId, (session) => {
        const files = session.files.map((file, idx) =>
          idx === fileIndex ? { ...file, status: 'error' as const, errorMessage: message } : file,
        );
        const next = { ...session, files };
        return { ...next, status: recomputeSessionStatus(next) };
      }),
    }));
  },

  markSessionDone: (sessionId) => {
    set((state) => ({
      sessions: mapSession(state.sessions, sessionId, (session) => {
        const next = {
          ...session,
          files: session.files.map((file) =>
            file.status === 'active' ? { ...file, status: 'done' as const, progress: 100 } : file,
          ),
        };
        return { ...next, status: recomputeSessionStatus(next) };
      }),
    }));
  },

  markSessionCanceled: (sessionId) => {
    set((state) => ({
      sessions: mapSession(state.sessions, sessionId, (session) => ({
        ...session,
        status: 'canceled' as const,
      })),
    }));
  },

  dismissSession: (sessionId) => {
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== sessionId),
    }));
    abortRegistry.delete(sessionId);
  },

  cancelSession: (sessionId) => {
    abortRegistry.get(sessionId)?.abort();
  },

  registerAbort: (sessionId, controller) => {
    abortRegistry.set(sessionId, controller);
  },
}));

/** Test helper: resets the store and the internal abort registry. */
export const resetUploadStoreForTests = () => {
  useUploadStore.setState({ sessions: [] });
  abortRegistry.clear();
  sessionCounter = 0;
};
