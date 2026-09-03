import { describe, expect, it } from 'vitest';
import { matchesTemplateFilter } from '../templateFilter';

const CS_PATTERN =
  '(counter[ -]?strike|\\bcs\\b|\\bhlds\\b|cstrike)[\\s\\S]*1\\.6|1\\.6[\\s\\S]*(counter[ -]?strike|\\bcs\\b|\\bhlds\\b|cstrike)|cstrike';

describe('matchesTemplateFilter', () => {
  it('shows unfiltered tabs everywhere, even while loading', () => {
    expect(matchesTemplateFilter(undefined, undefined)).toBe(true);
    expect(matchesTemplateFilter({}, { template: { name: 'Anything' } })).toBe(true);
  });

  it('hides filtered tabs while the server is still loading', () => {
    expect(matchesTemplateFilter({ namePattern: CS_PATTERN }, undefined)).toBe(false);
    expect(matchesTemplateFilter({ namePattern: CS_PATTERN }, null)).toBe(false);
  });

  it('shows the CS 1.6 tab for CS 1.6 templates', () => {
    for (const name of [
      'Counter Strike 1.6 - Vanilla',
      'Counter Strike 1.6 - ReHLDS',
      'My cs 1.6 server',
    ]) {
      expect(matchesTemplateFilter({ namePattern: CS_PATTERN }, { template: { name } })).toBe(true);
    }
  });

  it('hides the CS 1.6 tab for other templates', () => {
    for (const name of [
      'Counter-Strike 2',
      'Counter-Strike: Source',
      'Minecraft Server (Universal)',
      'Custom HLDS Engine Game',
      undefined,
    ]) {
      expect(
        matchesTemplateFilter({ namePattern: CS_PATTERN }, { template: { name } }),
      ).toBe(false);
    }
  });

  it('shows the tab for cstrike HLDS servers via environment match', () => {
    expect(
      matchesTemplateFilter(
        { namePattern: CS_PATTERN, env: { HLDS_GAME: 'cstrike' } },
        { template: { name: 'Custom HLDS Engine Game' }, environment: { HLDS_GAME: 'cstrike' } },
      ),
    ).toBe(true);
  });

  it('matches environment keys and values case-insensitively', () => {
    expect(
      matchesTemplateFilter(
        { env: { HLDS_GAME: 'cstrike' } },
        { template: { name: 'Custom' }, environment: { hlds_game: 'CSTrike' } },
      ),
    ).toBe(true);
    expect(
      matchesTemplateFilter(
        { env: { HLDS_GAME: 'cstrike' } },
        { template: { name: 'Custom' }, environment: { HLDS_GAME: 'valve' } },
      ),
    ).toBe(false);
  });

  it('treats an invalid name pattern as matching nothing', () => {
    expect(
      matchesTemplateFilter({ namePattern: '([' }, { template: { name: 'Counter Strike 1.6' } }),
    ).toBe(false);
  });
});
