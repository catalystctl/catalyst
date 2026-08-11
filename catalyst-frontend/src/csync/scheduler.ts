/** Microtask / rAF coalescing for cache subscriber notifications. */

type Listener = () => void;

export class Scheduler {
  private pending = new Set<Listener>();
  private scheduled = false;
  private readonly useRaf: boolean;

  constructor(opts?: { useRaf?: boolean }) {
    this.useRaf = opts?.useRaf ?? typeof requestAnimationFrame === 'function';
  }

  schedule(listener: Listener) {
    this.pending.add(listener);
    if (this.scheduled) return;
    this.scheduled = true;
    const flush = () => {
      this.scheduled = false;
      const batch = [...this.pending];
      this.pending.clear();
      for (const l of batch) {
        try {
          l();
        } catch {
          /* isolate listener errors */
        }
      }
    };
    if (this.useRaf) {
      requestAnimationFrame(flush);
    } else {
      queueMicrotask(flush);
    }
  }

  /** Flush immediately (tests). */
  flush() {
    this.scheduled = false;
    const batch = [...this.pending];
    this.pending.clear();
    for (const l of batch) l();
  }
}
