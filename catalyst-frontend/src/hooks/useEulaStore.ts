/**
 * External store for a pending EULA acceptance prompt (audit P1.9 / F12 / U5).
 *
 * `eula_required` is a one-shot event emitted by the agent when a server
 * boots with an unaccepted Minecraft EULA. It used to be observed only by the
 * per-server stream opened on ServerDetailsPage, so a start initiated from
 * any other surface (fleet list, console start button) showed no prompt.
 *
 * The AppLayout-mounted global stream (`useServerStateUpdates`) now writes
 * the event into this store and `useEulaPrompt` consumes it, so the prompt no
 * longer depends on one component's socket being open at the exact moment.
 *
 * useSyncExternalStore-compatible: snapshots are the stored objects themselves
 * (stable references), so unchanged state never re-renders.
 */
import { useSyncExternalStore } from 'react';

export type PendingEula = {
  serverId: string;
  message?: string;
  at: number;
};

const pending = new Map<string, PendingEula>();
const listeners = new Set<() => void>();

function emit(): void {
  // Copy first: a listener may unsubscribe while iterating.
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* isolate subscriber errors */
    }
  }
}

/** Record a pending EULA prompt for `serverId` (replaces any older one). */
export function setPendingEula(
  serverId: string,
  payload?: { eulaText?: unknown; message?: unknown } | null,
): void {
  if (!serverId) return;
  const text = payload?.eulaText ?? payload?.message;
  pending.set(serverId, {
    serverId,
    message: typeof text === 'string' && text.length > 0 ? text : undefined,
    at: Date.now(),
  });
  emit();
}

/** Take the pending prompt for `serverId` out of the store (one-shot). */
export function consumePendingEula(serverId?: string): PendingEula | null {
  if (!serverId) return null;
  const entry = pending.get(serverId) ?? null;
  if (entry) {
    pending.delete(serverId);
    emit();
  }
  return entry;
}

/** Non-React read: current pending prompt for `serverId`, if any. */
export function peekPendingEula(serverId?: string): PendingEula | null {
  if (!serverId) return null;
  return pending.get(serverId) ?? null;
}

export function subscribePendingEula(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Pending prompt for `serverId`; `null` when there is none. */
export function usePendingEula(serverId?: string): PendingEula | null {
  return useSyncExternalStore(
    subscribePendingEula,
    () => peekPendingEula(serverId),
    () => null,
  );
}
