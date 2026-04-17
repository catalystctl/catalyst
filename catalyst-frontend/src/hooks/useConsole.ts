/**
 * Console hook — uses SSE (Server-Sent Events) for real-time output.
 *
 * See useSseConsole.ts for the full optimized SSE implementation.
 * This file re-exports useSseConsole for compatibility.
 */
export { useSseConsole as useConsole } from './useSseConsole';
export type { ConsoleEntry } from './useSseConsole';
