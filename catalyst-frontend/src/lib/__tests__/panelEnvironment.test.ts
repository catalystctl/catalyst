import { describe, expect, it } from 'vitest';
import {
  buildEnvironmentPayload,
  isPanelManagedEnvKey,
  panelManagedEnvironment,
} from '../panelEnvironment';

const stored = {
  GAME_VERSION: 'stable',
  SEED: '',
  IMAGE_VARIANT: 'java17',
  TEMPLATE_IMAGE: 'eclipse-temurin:17-jre',
  CATALYST_NETWORK_IP: '10.0.0.5',
};

describe('panel-managed environment keys', () => {
  it('recognises the three fields the panel derives', () => {
    expect(isPanelManagedEnvKey('IMAGE_VARIANT')).toBe(true);
    expect(isPanelManagedEnvKey('TEMPLATE_IMAGE')).toBe(true);
    expect(isPanelManagedEnvKey('CATALYST_NETWORK_IP')).toBe(true);
    expect(isPanelManagedEnvKey('GAME_VERSION')).toBe(false);
    // The editor lets users type lowercase keys; matching stays exact.
    expect(isPanelManagedEnvKey('image_variant')).toBe(false);
  });

  it('lists the managed entries in a stable order and leaves the rest alone', () => {
    expect(panelManagedEnvironment(stored)).toEqual([
      { key: 'IMAGE_VARIANT', value: 'java17' },
      { key: 'TEMPLATE_IMAGE', value: 'eclipse-temurin:17-jre' },
      { key: 'CATALYST_NETWORK_IP', value: '10.0.0.5' },
    ]);
    expect(panelManagedEnvironment(undefined)).toEqual([]);
    expect(panelManagedEnvironment({ GAME_VERSION: 'stable' })).toEqual([]);
  });
});

describe('buildEnvironmentPayload', () => {
  it('keeps managed values from the server even when a row redefines them', () => {
    const payload = buildEnvironmentPayload(stored, [
      { key: 'GAME_VERSION', value: 'testing' },
      // A row naming a managed key must not win: the panel owns it.
      { key: 'IMAGE_VARIANT', value: 'java21' },
      { key: 'TEMPLATE_IMAGE', value: 'attacker/evil:latest' },
    ]);
    expect(payload).toEqual({
      IMAGE_VARIANT: 'java17',
      TEMPLATE_IMAGE: 'eclipse-temurin:17-jre',
      CATALYST_NETWORK_IP: '10.0.0.5',
      GAME_VERSION: 'testing',
    });
  });

  it('follows the rows for ordinary variables, including removal and empties', () => {
    const payload = buildEnvironmentPayload(stored, [
      { key: 'GAME_VERSION', value: 'stable' },
      { key: 'SEED', value: '' },
      // SEED stays empty; a removed row is simply absent from `rows`.
    ]);
    expect(payload).toEqual({
      IMAGE_VARIANT: 'java17',
      TEMPLATE_IMAGE: 'eclipse-temurin:17-jre',
      CATALYST_NETWORK_IP: '10.0.0.5',
      GAME_VERSION: 'stable',
      SEED: '',
    });
    const afterRemoval = buildEnvironmentPayload(stored, [{ key: 'GAME_VERSION', value: 'stable' }]);
    expect(afterRemoval.SEED).toBeUndefined();
  });

  it('ignores blank and whitespace-only keys', () => {
    const payload = buildEnvironmentPayload(undefined, [
      { key: '', value: 'orphan' },
      { key: '   ', value: 'orphan' },
      { key: ' EXTRA ', value: 'kept' },
    ]);
    expect(payload).toEqual({ EXTRA: 'kept' });
  });

  it('round-trips a stored environment unchanged', () => {
    const rows = Object.entries(stored).map(([key, value]) => ({ key, value }));
    expect(buildEnvironmentPayload(stored, rows)).toEqual(stored);
  });
});
