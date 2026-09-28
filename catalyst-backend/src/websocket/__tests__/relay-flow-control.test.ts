import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RELAY_FLOW_CONFIG,
  evaluateRelayFlow,
  initialRelayFlowState,
  type RelayFlowConfig,
} from '../relay-flow-control';

const MIB = 1024 * 1024;

const config: RelayFlowConfig = {
  lowWaterBytes: 8 * MIB,
  initialHighWaterBytes: 32 * MIB,
  ceilingBytes: 256 * MIB,
  stallMs: 90_000,
};

const T0 = 1_700_000_000_000;

describe('relay flow control', () => {
  it('does nothing while the target keeps up', () => {
    const state = initialRelayFlowState(config, T0);
    const decision = evaluateRelayFlow(state, 1 * MIB, config, T0 + 500);
    expect(decision.action).toBe('none');
    expect(decision.state.paused).toBe(false);
    expect(decision.state.highWaterBytes).toBe(32 * MIB);
  });

  it('pauses the source at the high watermark and grows the budget', () => {
    const state = initialRelayFlowState(config, T0);
    const decision = evaluateRelayFlow(state, 32 * MIB, config, T0 + 1000);
    expect(decision.action).toBe('pause');
    expect(decision.state.paused).toBe(true);
    // Budget doubles so a repeatedly-slow-but-healthy target is not thrashed.
    expect(decision.state.highWaterBytes).toBe(64 * MIB);
  });

  it('never grows the budget past the ceiling', () => {
    let state = initialRelayFlowState(config, T0);
    let now = T0;
    for (let i = 0; i < 10; i++) {
      const decision = evaluateRelayFlow(state, 300 * MIB, config, now);
      state = decision.state;
      now += 1000;
      if (decision.action === 'pause') {
        // Simulate the target draining enough to resume, then lagging again.
        state = evaluateRelayFlow(state, 0, config, now).state;
        now += 1000;
      }
    }
    expect(state.highWaterBytes).toBeLessThanOrEqual(config.ceilingBytes);
  });

  it('resumes the source once the target drains below the low watermark', () => {
    let state = initialRelayFlowState(config, T0);
    state = evaluateRelayFlow(state, 40 * MIB, config, T0 + 1000).state;
    expect(state.paused).toBe(true);

    const decision = evaluateRelayFlow(state, 4 * MIB, config, T0 + 5000);
    expect(decision.action).toBe('resume');
    expect(decision.state.paused).toBe(false);
  });

  it('treats an idle target (buffer already empty) as draining, not stalled', () => {
    const state = initialRelayFlowState(config, T0);
    const decision = evaluateRelayFlow(state, 0, config, T0 + 10 * 60_000);
    expect(decision.action).toBe('none');
  });

  it('does not abort a slow target that is still making progress', () => {
    let state = initialRelayFlowState(config, T0);
    // Buffer shrinks a little on every observation, just very slowly.
    let buffered = 64 * MIB;
    let now = T0;
    for (let i = 0; i < 40; i++) {
      buffered -= 1 * MIB;
      now += 30_000;
      state = evaluateRelayFlow(state, buffered, config, now).state;
    }
    // 20 minutes elapsed, but progress was continuous: no abort, source paused.
    expect(state.paused).toBe(true);
  });

  it('aborts only when the target stops draining for the stall window', () => {
    const state = initialRelayFlowState(config, T0);
    const stillBuffered = 64 * MIB;

    // Just inside the window: keep waiting rather than killing the transfer.
    const almost = evaluateRelayFlow(
      { ...state, lastBufferedAmount: stillBuffered, lastDrainAt: T0 },
      stillBuffered,
      config,
      T0 + config.stallMs - 1,
    );
    expect(almost.action).not.toBe('abort');

    const stalled = evaluateRelayFlow(
      { ...state, lastBufferedAmount: stillBuffered, lastDrainAt: T0 },
      stillBuffered,
      config,
      T0 + config.stallMs + 1,
    );
    expect(stalled.action).toBe('abort');
    expect(stalled.reason).toContain('without draining');
  });

  it('ships defaults that tolerate a real cross-node copy', () => {
    expect(DEFAULT_RELAY_FLOW_CONFIG.initialHighWaterBytes).toBeGreaterThanOrEqual(16 * MIB);
    expect(DEFAULT_RELAY_FLOW_CONFIG.ceilingBytes).toBeGreaterThanOrEqual(
      DEFAULT_RELAY_FLOW_CONFIG.initialHighWaterBytes,
    );
    expect(DEFAULT_RELAY_FLOW_CONFIG.stallMs).toBeGreaterThanOrEqual(60_000);
  });
});
