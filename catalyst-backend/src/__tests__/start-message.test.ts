/**
 * Guards for `services/start-message.ts`.
 *
 * The bug class these tests exist for: every (re)start path hand-wrote the
 * agent payload *and* hand-derived its inputs. The payload drifted (three paths
 * dropped `allocatedSwapMb`/`ioWeight`, so those restarts recreated the server
 * with no swap and the default I/O weight) and the inputs drifted too — only
 * the HTTP start route resolved `TEMPLATE_IMAGE`, so a server with an image
 * variant that a task, a crash or a node reboot restarted pulled the template's
 * default image; three paths also ignored the server's own startup command.
 *
 * `buildServerStartMessage` now derives both from the server row and every
 * producer calls it. The source scans at the bottom are the part that keeps a
 * future producer from quietly going back to hand-writing a payload.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildServerStartMessage,
  buildStartServerMessage,
  DEFAULT_SERVER_DATA_DIR,
  type StartMessageServer,
  type StartMessageServerRow,
} from '../services/start-message.js';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const server: StartMessageServer = {
  id: 'srv_1',
  uuid: 'uuid-1',
  allocatedMemoryMb: 2048,
  allocatedCpuCores: 2,
  allocatedDiskMb: 10240,
  allocatedSwapMb: 512,
  ioWeight: 400,
  cpuAffinity: '0-1',
  primaryPort: 25565,
  networkMode: 'bridge',
};

/** A realistic row: image variant, template defaults, no startup override. */
const row: StartMessageServerRow = {
  ...server,
  name: 'Survival',
  primaryIp: '10.0.0.5',
  environment: {
    SERVER_TYPE: 'paper',
    IMAGE_VARIANT: 'Eclipse Temurin 17 JRE (Java 17)',
  },
  startupCommand: null,
  template: {
    image: 'eclipse-temurin:21-jre',
    images: [
      { name: 'Eclipse Temurin 21 JRE (Java 21)', image: 'eclipse-temurin:21-jre' },
      { name: 'Eclipse Temurin 17 JRE (Java 17)', image: 'eclipse-temurin:17-jre' },
    ],
    variables: [
      { name: 'MEMORY', default: '1024' },
      { name: 'EULA', default: 'false' },
    ],
    startup: 'java -Xmx{{MEMORY}}M -jar server.jar',
  },
  node: { serverDataDir: '/srv/catalyst', publicAddress: '203.0.113.10' },
};

// ── The low-level builder ───────────────────────────────────────────────────

describe('buildStartServerMessage', () => {
  it('always carries every resource the agent spec consumes', () => {
    const message = buildStartServerMessage({
      type: 'start_server',
      server,
      template: { startup: 'java -jar server.jar' },
      environment: { A: '1' },
      portBindings: { 25565: 25565 },
    });

    expect(message).toEqual({
      type: 'start_server',
      serverId: 'srv_1',
      serverUuid: 'uuid-1',
      template: { startup: 'java -jar server.jar' },
      environment: { A: '1' },
      allocatedMemoryMb: 2048,
      allocatedCpuCores: 2,
      allocatedDiskMb: 10240,
      allocatedSwapMb: 512,
      ioWeight: 400,
      cpuAffinity: '0-1',
      primaryPort: 25565,
      portBindings: { 25565: 25565 },
      networkMode: 'bridge',
    });
  });

  it('fills the agent defaults for rows that predate a column instead of dropping the key', () => {
    const message = buildStartServerMessage({
      type: 'restart_server',
      server: { ...server, allocatedSwapMb: null, ioWeight: null, cpuAffinity: null },
      template: {},
      environment: {},
    });

    expect(message.allocatedSwapMb).toBe(0);
    expect(message.ioWeight).toBe(500);
    // Explicit null, never a missing key: "unpinned" must be unambiguous.
    expect(message).toHaveProperty('cpuAffinity', null);
    // No resolved bindings passed -> the row's own map, never undefined.
    expect(message.portBindings).toEqual({});
  });

  it('only sends autoRestart when the caller asks for it', () => {
    const without = buildStartServerMessage({
      type: 'restart_server',
      server,
      template: {},
      environment: {},
    });
    expect(without).not.toHaveProperty('autoRestart');

    const withPolicy = buildStartServerMessage({
      type: 'start_server',
      server,
      template: {},
      environment: {},
      autoRestart: { enabled: true, delay: 10, maxRestarts: 5, windowSecs: 60 },
    });
    expect(withPolicy.autoRestart).toEqual({
      enabled: true,
      delay: 10,
      maxRestarts: 5,
      windowSecs: 60,
    });
  });

  it('contains no undefined-valued resource keys (an absent key is a silent default)', () => {
    const message = buildStartServerMessage({
      type: 'start_server',
      server: { ...server, allocatedSwapMb: undefined, ioWeight: undefined, cpuAffinity: undefined },
      template: {},
      environment: {},
    });
    for (const [key, value] of Object.entries(message)) {
      expect(value, `${key} must not be undefined`).not.toBeUndefined();
    }
  });
});

// ── The composer every producer calls ───────────────────────────────────────

describe('buildServerStartMessage', () => {
  it('sends the resolved image variant, not the template default', () => {
    // The agent reads TEMPLATE_IMAGE and only falls back to template.image, so
    // a path that forgot this restarted the server on the wrong image.
    const { message } = buildServerStartMessage({ type: 'start_server', server: row });
    expect((message.environment as Record<string, string>).TEMPLATE_IMAGE).toBe(
      'eclipse-temurin:17-jre',
    );
  });

  it('falls back to the template image when no variant is selected', () => {
    const { message } = buildServerStartMessage({
      type: 'start_server',
      server: { ...row, environment: {} },
    });
    expect((message.environment as Record<string, string>).TEMPLATE_IMAGE).toBe(
      'eclipse-temurin:21-jre',
    );
  });

  it('merges template variable defaults under the stored values', () => {
    const { message } = buildServerStartMessage({
      type: 'start_server',
      server: { ...row, environment: { EULA: 'true' } },
    });
    const environment = message.environment as Record<string, string>;
    expect(environment.EULA).toBe('true'); // stored value wins
    expect(environment.MEMORY).toBe('1024'); // template default present
  });

  it('applies the server startup command over the template startup', () => {
    const { message } = buildServerStartMessage({
      type: 'restart_server',
      server: { ...row, startupCommand: 'java -Xmx3072M -jar custom.jar' },
    });
    expect((message.template as Record<string, unknown>).startup).toBe(
      'java -Xmx3072M -jar custom.jar',
    );
    // The Pterodactyl-compatible STARTUP var must follow the same command.
    expect((message.environment as Record<string, string>).STARTUP).toBe(
      'java -Xmx3072M -jar custom.jar',
    );
  });

  it('keeps the template startup when the server has no override', () => {
    const { message } = buildServerStartMessage({ type: 'start_server', server: row });
    expect((message.template as Record<string, unknown>).startup).toBe(
      'java -Xmx{{MEMORY}}M -jar server.jar',
    );
  });

  it('patches the runtime template fields older rows do not carry', () => {
    const { message } = buildServerStartMessage({
      type: 'start_server',
      server: { ...row, template: { image: 'alpine:latest', startup: 'sh' } },
    });
    expect(message.template).toMatchObject({
      stopCommand: 'stop',
      sendSignalTo: 'SIGTERM',
      installImage: 'alpine:3.19',
    });
  });

  it('puts the server data directory on the node, then in the env, then the default', () => {
    const fromNode = buildServerStartMessage({ type: 'start_server', server: row });
    expect((fromNode.message.environment as Record<string, string>).SERVER_DIR).toBe(
      '/srv/catalyst/uuid-1',
    );

    const explicit = buildServerStartMessage({
      type: 'start_server',
      server: row,
      serverDataDir: '/explicit/data',
    });
    expect((explicit.message.environment as Record<string, string>).SERVER_DIR).toBe(
      '/explicit/data/uuid-1',
    );

    const fallback = buildServerStartMessage({
      type: 'start_server',
      server: { ...row, node: null },
    });
    const expected = `${process.env.SERVER_DATA_DIR ?? DEFAULT_SERVER_DATA_DIR}/uuid-1`;
    expect((fallback.message.environment as Record<string, string>).SERVER_DIR).toBe(expected);
  });

  it('uses the assigned IP, and the node address in host mode', () => {
    const assigned = buildServerStartMessage({ type: 'start_server', server: row });
    expect((assigned.message.environment as Record<string, string>).CATALYST_NETWORK_IP).toBe(
      '10.0.0.5',
    );

    const host = buildServerStartMessage({
      type: 'start_server',
      server: { ...row, primaryIp: null, networkMode: 'host' },
    });
    expect((host.message.environment as Record<string, string>).CATALYST_NETWORK_IP).toBe(
      '203.0.113.10',
    );
    expect(host.hostNetworkIpError).toBeUndefined();
  });

  it('reports an unusable node address instead of building a half-usable payload', () => {
    const { message, hostNetworkIpError } = buildServerStartMessage({
      type: 'start_server',
      server: { ...row, primaryIp: null, networkMode: 'host', node: { publicAddress: 'not-an-ip' } },
    });
    expect(hostNetworkIpError).toBeTruthy();
    expect((message.environment as Record<string, string>).CATALYST_NETWORK_IP).toBeUndefined();
    // The rest of the message is still complete: callers warn (crash restart,
    // cron, replay) or answer 400 (the start route), they never get a payload
    // with the resource fields missing.
    expect(message.allocatedCpuCores).toBe(2);
  });

  it('syncs port variables and injects the Pterodactyl builtins', () => {
    const { message } = buildServerStartMessage({
      type: 'start_server',
      server: {
        ...row,
        environment: { ...(row.environment as Record<string, string>), SERVER_PORT: '9999' },
        portBindings: { 25565: 25570 } as Record<number, number>,
      },
    });
    const environment = message.environment as Record<string, string>;
    expect(environment.SERVER_PORT).toBe('25565');
    expect(environment.SERVER_MEMORY).toBe('2048');
    expect(environment.SERVER_UUID).toBe('uuid-1');
    expect(environment.SERVER_IP).toBe('10.0.0.5');
  });

  it('parses the stored portBindings JSON when the caller passes no map', () => {
    const { message } = buildServerStartMessage({
      type: 'start_server',
      server: { ...row, portBindings: { '25565': 25570, bogus: 1 } },
    });
    expect(message.portBindings).toEqual({ 25565: 25570 });
  });

  it('sends every resource field the agent spec consumes', () => {
    const { message } = buildServerStartMessage({ type: 'start_server', server: row });
    expect(message).toMatchObject({
      type: 'start_server',
      serverId: 'srv_1',
      serverUuid: 'uuid-1',
      allocatedMemoryMb: 2048,
      allocatedCpuCores: 2,
      allocatedDiskMb: 10240,
      allocatedSwapMb: 512,
      ioWeight: 400,
      cpuAffinity: '0-1',
      primaryPort: 25565,
      networkMode: 'bridge',
    });
  });

  it('toggles the type for a restart and forwards autoRestart', () => {
    const { message } = buildServerStartMessage({
      type: 'restart_server',
      server: row,
      autoRestart: { enabled: false, delay: 10, maxRestarts: 5, windowSecs: 60 },
    });
    expect(message.type).toBe('restart_server');
    expect(message.autoRestart).toEqual({
      enabled: false,
      delay: 10,
      maxRestarts: 5,
      windowSecs: 60,
    });
  });
});

// ── Drift guards: the source, not one payload, is what has to hold ─────────

function backendSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      backendSources(full, acc);
    } else if (entry.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('every start/restart producer goes through the composer', () => {
  // Nine producers, not the seven the first unification assumed: the two bulk
  // image-variant paths in routes/admin.ts were written with single quotes and
  // so escaped both the grep and the guard below.
  const producers = [
    'routes/servers/power.ts',
    'routes/admin.ts',
    'websocket/gateway.ts',
    'server.ts',
  ];
  const composerFile = 'services/start-message.ts';

  it('builds each start/restart payload with the composer', () => {
    for (const relative of producers) {
      const source = readFileSync(join(srcRoot, relative), 'utf8');
      const literals = (source.match(/type: ["'](?:start|restart)_server["']/g) ?? []).length;
      const composerCalls = (source.match(/buildServerStartMessage\(/g) ?? []).length;
      expect(
        { file: relative, composerCalls, literals },
        `${relative} must build start/restart payloads through buildServerStartMessage`,
      ).toEqual({ file: relative, composerCalls: Math.max(literals, 1), literals });
      expect(source).toMatch(/import \{ buildServerStartMessage \} from/);
    }
  });

  it('keeps the low-level builder private to the composer', () => {
    // A direct call is how the inputs get hand-derived again.
    const callers = backendSources(srcRoot)
      .map((file) => relative(srcRoot, file))
      .filter((file) => file !== composerFile)
      .filter((file) => readFileSync(join(srcRoot, file), 'utf8').includes('buildStartServerMessage('));
    expect(callers).toEqual([]);
  });

  it('has no other file constructing a start/restart message from scratch', () => {
    const offenders = backendSources(srcRoot)
      .map((file) => relative(srcRoot, file))
      .filter((file) => !producers.includes(file) && file !== composerFile)
      .filter((file) => /type:\s*["'](?:start|restart)_server["']/.test(readFileSync(join(srcRoot, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('leaves image resolution and the startup override to the composer', () => {
    // The image is set for installs and admin variant switches too, so the rule
    // is about the *start producers*: none of them may resolve the image or
    // fold the startup command itself.
    for (const relative of producers) {
      const source = readFileSync(join(srcRoot, relative), 'utf8');
      expect(source, `${relative} resolves TEMPLATE_IMAGE itself`).not.toMatch(/TEMPLATE_IMAGE\s*=/);
      expect(source, `${relative} resolves the image itself`).not.toMatch(/resolveTemplateImage\(/);
      expect(source, `${relative} folds the startup command itself`).not.toMatch(
        /\.startup\s*=\s*server\.startupCommand/,
      );
    }
  });
});
