import { describe, expect, it } from 'vitest';
import { PluginWorkerHost } from '../plugin-worker-host';

describe('PluginWorkerHost', () => {
  it('fails closed while isolated host IPC is unavailable', async () => {
    const host = new PluginWorkerHost({
      name: 'isolated-test',
      version: '1.0.0',
      displayName: 'Isolated test',
      description: '',
      author: 'test',
      catalystVersion: '1.0.0',
      permissions: [],
      runtime: 'isolated',
    }, '/tmp/plugin');

    await expect(host.start()).rejects.toThrow(
      'Isolated plugin execution is unavailable: worker host IPC does not implement PluginBackendContext',
    );
  });
});
