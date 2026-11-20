import { describe, expect, it } from 'vitest';
import { convertPterodactylEgg } from './pterodactylImport';

describe('convertPterodactylEgg disk default', () => {
  it('carries the Steam app recommendation into allocatedDiskMb', () => {
    const converted = convertPterodactylEgg({
      name: 'Counter-Strike 2',
      docker_images: { java: 'ghcr.io/pterodactyl/yolks:java_21' },
      startup: 'java -jar server.jar',
      config: { stop: 'stop' },
      scripts: { installation: { script: 'echo install' } },
      features: ['steam_disk_space'],
      variables: [
        {
          name: 'Source AppID',
          env_variable: 'SRCDS_APPID',
          default_value: '730',
        },
      ],
    });

    expect(converted.allocatedDiskMb).toBe(40960);
    expect((converted.features as Record<string, unknown>).recommendedDiskMb).toBe(40960);
  });

  it('falls back to the standard 10 GiB', () => {
    const converted = convertPterodactylEgg({
      name: 'Paper',
      docker_images: { java: 'ghcr.io/pterodactyl/yolks:java_21' },
      startup: 'java -jar server.jar',
      config: { stop: 'stop' },
      scripts: { installation: { script: 'echo install' } },
      variables: [],
    });

    expect(converted.allocatedDiskMb).toBe(10240);
  });
});
