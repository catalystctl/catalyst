import { describe, it, expect } from 'vitest';

import { deriveTemplatePort, parseEggConfigFiles } from './eggPort';

// Mirrors catalyst-backend/src/utils/egg-port.ts — keep the suites in sync.
describe('parseEggConfigFiles', () => {
  it('parses the JSON-string form used by Pterodactyl exports', () => {
    expect(parseEggConfigFiles('{"a.json":{"parser":"json"}}')).toEqual({
      'a.json': { parser: 'json' },
    });
  });

  it('passes through the object form used by Pelican exports', () => {
    const obj = { 'a.json': { parser: 'json' } };
    expect(parseEggConfigFiles(obj)).toBe(obj);
  });

  it('returns null for missing or malformed input', () => {
    expect(parseEggConfigFiles(undefined)).toBeNull();
    expect(parseEggConfigFiles('')).toBeNull();
    expect(parseEggConfigFiles('not json')).toBeNull();
    expect(parseEggConfigFiles(42)).toBeNull();
  });
});

describe('deriveTemplatePort', () => {
  it('prefers an explicit ports array (Catalyst extension)', () => {
    expect(deriveTemplatePort({ ports: [15637] })).toBe(15637);
  });

  it('accepts object entries in the ports array', () => {
    expect(deriveTemplatePort({ ports: [{ port: 8211 }] })).toBe(8211);
  });

  it('reads a literal port from the egg config-file bindings', () => {
    expect(
      deriveTemplatePort({
        config: {
          files: JSON.stringify({
            'cfg.json': { parser: 'json', find: { queryPort: '15637' } },
          }),
        },
      }),
    ).toBe(15637);
  });

  it('recognises server-port / listen_port key spellings', () => {
    for (const key of ['server-port', 'listen_port', 'gamePort']) {
      expect(
        deriveTemplatePort({
          config: {
            files: { 'x.properties': { parser: 'properties', find: { [key]: '27015' } } },
          },
        }),
      ).toBe(27015);
    }
  });

  it('returns null when the config only binds the panel-allocated port', () => {
    // {{server.build.default.port}} means "whatever the panel allocates" —
    // the egg pins no game-specific port, so we must not guess.
    expect(
      deriveTemplatePort({
        config: {
          files: JSON.stringify({
            'cfg.json': {
              parser: 'json',
              find: { queryPort: '{{server.build.default.port}}' },
            },
          }),
        },
      }),
    ).toBeNull();
  });

  it('honours a variable pinned to a single value by its rules', () => {
    expect(
      deriveTemplatePort({
        variables: [
          { name: 'QUERY_PORT', env_variable: 'QUERY_PORT', rules: 'required|integer|in:15637' },
        ],
      }),
    ).toBe(15637);
  });

  it('ignores a variable that merely defaults to a port without pinning it', () => {
    // A bare default is a suggestion, not a declaration — guessing 25565 here
    // is exactly the bug this module exists to prevent.
    expect(
      deriveTemplatePort({
        variables: [
          { name: 'SERVER_PORT', env_variable: 'SERVER_PORT', default_value: '25565' },
        ],
      }),
    ).toBeNull();
  });

  it('ignores non-integer and out-of-range ports', () => {
    expect(
      deriveTemplatePort({
        config: { files: { 'a.json': { find: { port: '15637/udp' } } } },
      }),
    ).toBeNull();
    expect(deriveTemplatePort({ ports: [80] })).toBeNull();
    expect(deriveTemplatePort({ ports: [70000] })).toBeNull();
  });

  it('returns null when the egg says nothing about ports', () => {
    expect(deriveTemplatePort({})).toBeNull();
    expect(deriveTemplatePort({ variables: [], config: {} })).toBeNull();
  });
});
