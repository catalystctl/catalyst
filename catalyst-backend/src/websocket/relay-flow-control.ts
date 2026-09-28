/**
 * Adaptive backpressure for the bulk agent→agent relay.
 *
 * A fixed watermark is the wrong model for bulk copies. A slow target is
 * normal — it is extracting a tar and writing to disk while the source is
 * reading a fast local filesystem — and aborting the transfer throws away work
 * that would have finished. The relay instead:
 *
 *   1. asks the source agent to pause/resume around a low/high watermark, so
 *      panel memory stays bounded without losing the transfer;
 *   2. grows the high watermark (up to a ceiling) while the target keeps
 *      draining, so a persistently slow-but-healthy node is not throttled into
 *      a pause/resume loop;
 *   3. aborts only when the target stops draining altogether for `stallMs` —
 *      a genuinely stuck consumer — rather than on a transient lag.
 *
 * The decision logic is pure so it can be tested without a live WebSocket.
 */

export interface RelayFlowConfig {
  /** Resume the source once the target buffer falls to or below this. */
  lowWaterBytes: number;
  /** Pause the source when the target buffer reaches this. */
  initialHighWaterBytes: number;
  /** Never grow the high watermark beyond this. */
  ceilingBytes: number;
  /** No drain at all for this long, while buffered, means a stuck target. */
  stallMs: number;
}

export interface RelayFlowState {
  highWaterBytes: number;
  paused: boolean;
  lastBufferedAmount: number;
  /** Last time the target made progress (drained or drained fully). */
  lastDrainAt: number;
}

export type RelayFlowAction = 'none' | 'pause' | 'resume' | 'abort';

export interface RelayFlowDecision {
  action: RelayFlowAction;
  state: RelayFlowState;
  reason?: string;
}

const MIB = 1024 * 1024;

/**
 * Defaults sized for a cross-node full clone / node transfer. The low/high
 * pair keeps steady-state buffering small; the ceiling bounds worst-case panel
 * memory for a target that cannot be paused (an older agent ignores the flow
 * command) before the stall detector fires.
 */
export const DEFAULT_RELAY_FLOW_CONFIG: RelayFlowConfig = {
  lowWaterBytes: Number(process.env.RELAY_BACKPRESSURE_LOW_BYTES) > 0
    ? Number(process.env.RELAY_BACKPRESSURE_LOW_BYTES)
    : 8 * MIB,
  initialHighWaterBytes: Number(process.env.RELAY_BACKPRESSURE_HIGH_BYTES) > 0
    ? Number(process.env.RELAY_BACKPRESSURE_HIGH_BYTES)
    : 32 * MIB,
  ceilingBytes: Number(process.env.RELAY_BACKPRESSURE_CEILING_BYTES) > 0
    ? Number(process.env.RELAY_BACKPRESSURE_CEILING_BYTES)
    : 256 * MIB,
  stallMs: Number(process.env.RELAY_STALL_MS) > 0 ? Number(process.env.RELAY_STALL_MS) : 90_000,
};

export function initialRelayFlowState(
  config: RelayFlowConfig,
  now: number,
): RelayFlowState {
  return {
    highWaterBytes: Math.min(config.initialHighWaterBytes, config.ceilingBytes),
    paused: false,
    lastBufferedAmount: 0,
    lastDrainAt: now,
  };
}

/**
 * Decide what to do after forwarding a chunk, given the target's buffer.
 * `bufferedAmount` is read *after* the chunk was queued.
 */
export function evaluateRelayFlow(
  state: RelayFlowState,
  bufferedAmount: number,
  config: RelayFlowConfig,
  now: number,
): RelayFlowDecision {
  let { highWaterBytes, lastDrainAt } = state;
  const { paused } = state;

  // Progress is either "the buffer emptied to the low watermark" or "it shrank
  // since the last look". A completely idle target (buffer already at 0) counts
  // as draining, otherwise a fast target would look stalled.
  const drained =
    bufferedAmount <= config.lowWaterBytes || bufferedAmount < state.lastBufferedAmount;
  if (drained) lastDrainAt = now;

  const stalled = bufferedAmount > config.lowWaterBytes && now - lastDrainAt > config.stallMs;
  if (stalled) {
    return {
      action: 'abort',
      state: { highWaterBytes, paused, lastBufferedAmount: bufferedAmount, lastDrainAt },
      reason: `target buffered ${bufferedAmount} bytes without draining for ${config.stallMs}ms`,
    };
  }

  if (!paused && bufferedAmount >= highWaterBytes) {
    // Increase the budget for next time so a healthy-but-slow target is not
    // paused over and over; never exceed the ceiling.
    const grown = Math.max(bufferedAmount * 2, highWaterBytes * 2);
    highWaterBytes = Math.min(config.ceilingBytes, grown);
    return {
      action: 'pause',
      state: { highWaterBytes, paused: true, lastBufferedAmount: bufferedAmount, lastDrainAt },
      reason: `high water (${bufferedAmount}/${highWaterBytes} bytes)`,
    };
  }

  if (paused && bufferedAmount <= config.lowWaterBytes) {
    return {
      action: 'resume',
      state: { highWaterBytes, paused: false, lastBufferedAmount: bufferedAmount, lastDrainAt },
      reason: 'drained below low water',
    };
  }

  return {
    action: 'none',
    state: { highWaterBytes, paused, lastBufferedAmount: bufferedAmount, lastDrainAt },
  };
}
