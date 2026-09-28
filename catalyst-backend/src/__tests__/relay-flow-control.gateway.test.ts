import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSocketGateway } from '../websocket/gateway.js';
import {
  DEFAULT_RELAY_FLOW_CONFIG,
  initialRelayFlowState,
} from '../websocket/relay-flow-control.js';

/**
 * Relay flow-control orchestration.
 *
 * The pure watermark decisions live in relay-flow-control.test.ts. These tests
 * cover the wiring around them — in particular the drain watcher: while the
 * source is paused no binary frames arrive, so the resume can only be observed
 * on a timer. Without it a paused transfer wedged until the relay timeout.
 */

const prismaStub: any = {
  systemSetting: { findUnique: async () => null },
  node: { findUnique: async () => null, update: async () => ({}) },
  server: { findUnique: async () => null, findMany: async () => [] },
};
const loggerStub: any = {
  child: () => loggerStub,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const MIB = 1024 * 1024;

function makeTargetAgent(bufferedAmount: number) {
  return {
    nodeId: 'dst-node',
    authenticated: true,
    socket: { readyState: 1, bufferedAmount, send: () => {} },
  };
}

function makeGateway() {
  const gw: any = new WebSocketGateway(prismaStub, loggerStub);
  gw.sendToAgent = vi.fn(async () => true);
  const resolve = vi.fn();
  const reject = vi.fn();
  gw.activeBackupRelay = {
    sourceNodeId: 'src-node',
    targetNodeId: 'dst-node',
    requestId: 'req-1',
    flow: initialRelayFlowState(DEFAULT_RELAY_FLOW_CONFIG, Date.now()),
    resolve,
    reject,
  };
  return { gw, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('relay flow control orchestration', () => {
  it('pauses the source when the target buffer crosses the high watermark', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { gw } = makeGateway();

    const target = makeTargetAgent(DEFAULT_RELAY_FLOW_CONFIG.initialHighWaterBytes);
    gw.applyRelayFlowControl('src-node', target);

    expect(gw.sendToAgent).toHaveBeenCalledTimes(1);
    expect(gw.sendToAgent.mock.calls[0][1]).toMatchObject({
      type: 'backup_stream_flow',
      requestId: 'req-1',
      paused: true,
    });
    expect(gw.activeBackupRelay.flow.paused).toBe(true);
    expect(gw.activeBackupRelay.flowTimer).toBeDefined();
  });

  it('resumes on the drain timer even though no further frames arrive', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { gw } = makeGateway();

    // Cross the high watermark: the source is asked to pause.
    const target = makeTargetAgent(DEFAULT_RELAY_FLOW_CONFIG.initialHighWaterBytes);
    gw.applyRelayFlowControl('src-node', target);
    expect(gw.activeBackupRelay.flow.paused).toBe(true);
    gw.sendToAgent.mockClear();

    // The target now drains. Crucially, no binary frame arrives to trigger
    // re-evaluation — this is the case that previously wedged the transfer.
    target.socket.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(400);

    expect(gw.sendToAgent).toHaveBeenCalledTimes(1);
    expect(gw.sendToAgent.mock.calls[0][1]).toMatchObject({
      type: 'backup_stream_flow',
      paused: false,
    });
    expect(gw.activeBackupRelay.flow.paused).toBe(false);
    // The watcher is stopped once the stream is flowing again.
    expect(gw.activeBackupRelay.flowTimer).toBeUndefined();
  });

  it('aborts only a target that stops draining for the stall window', () => {
    vi.useFakeTimers();
    const now = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(now);
    const { gw, reject } = makeGateway();

    // Buffered and no progress for longer than the stall window.
    gw.activeBackupRelay.flow = {
      ...initialRelayFlowState(DEFAULT_RELAY_FLOW_CONFIG, now.getTime()),
      lastBufferedAmount: 64 * MIB,
      lastDrainAt: now.getTime() - DEFAULT_RELAY_FLOW_CONFIG.stallMs - 1000,
    };

    gw.applyRelayFlowControl('src-node', makeTargetAgent(64 * MIB));

    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0].message).toContain('stalled');
    expect(gw.activeBackupRelay).toBeNull();
  });

  it('keeps a slow-but-draining target alive instead of aborting it', () => {
    vi.useFakeTimers();
    const now = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(now);
    const { gw, reject } = makeGateway();

    // Past the stall window, but the buffer has shrunk since the last look.
    gw.activeBackupRelay.flow = {
      ...initialRelayFlowState(DEFAULT_RELAY_FLOW_CONFIG, now.getTime()),
      lastBufferedAmount: 64 * MIB,
      lastDrainAt: now.getTime() - DEFAULT_RELAY_FLOW_CONFIG.stallMs - 1000,
      highWaterBytes: 8 * MIB,
    };

    gw.applyRelayFlowControl('src-node', makeTargetAgent(32 * MIB));

    expect(reject).not.toHaveBeenCalled();
    expect(gw.activeBackupRelay).not.toBeNull();
  });
});
