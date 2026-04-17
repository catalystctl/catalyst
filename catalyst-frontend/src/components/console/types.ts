/**
 * Console types — shared between main thread and worker.
 */

export type RawEntry = {
  id: string;
  stream: string;
  data: string;
  timestamp?: string;
};

export type ProcessedEntry = {
  id: string;
  stream: string;
  timestamp: string;
  html: string;
  /** Raw visible character count (HTML tags stripped) — used for deterministic row height. */
  textLength: number;
};
