/**
 * Tests for the fastdl-sync plugin's pure logic (catalyst-plugins/fastdl-sync/backend/logic.js).
 */
import { describe, it, expect } from 'vitest';
import {
  isDownloadableContent,
  gameDirOf,
  mapToFastdlPath,
  diffFileLists,
  buildDownloadUrl,
} from '../../../../catalyst-plugins/fastdl-sync/backend/logic.js';

describe('isDownloadableContent', () => {
  it('accepts content in known content dirs', () => {
    expect(isDownloadableContent('cstrike/maps/de_dust2.bsp')).toBe(true);
    expect(isDownloadableContent('garrysmod/models/player/group01/male_07.mdl')).toBe(true);
    expect(isDownloadableContent('cstrike/sound/weapons/ak47/shoot1.wav')).toBe(true);
    expect(isDownloadableContent('tf2/materials/console/background1.vtf')).toBe(true);
    expect(isDownloadableContent('tf2/resource/ui/hud.res')).toBe(true);
    expect(isDownloadableContent('cstrike/overviews/de_dust2.bmp')).toBe(true);
    expect(isDownloadableContent('cstrike/events/player.sc')).toBe(true);
    expect(isDownloadableContent('cstrike/gfx/vgui/640_logo.tga')).toBe(true);
    expect(isDownloadableContent('cstrike/media/gamestart.mp3')).toBe(true);
    expect(isDownloadableContent('cstrike/particles/impact_fx.pcf')).toBe(true);
  });

  it('accepts root-level .wad files in a game dir', () => {
    expect(isDownloadableContent('cstrike/de_chateau.wad')).toBe(true);
    expect(isDownloadableContent('csgo/packages/whatever.wad')).toBe(false); // not at root
  });

  it('rejects non-downloadable locations', () => {
    expect(isDownloadableContent('cstrike/addons/metamod/metamod.dll')).toBe(false);
    expect(isDownloadableContent('cstrike/cfg/server.cfg')).toBe(false);
    expect(isDownloadableContent('cstrike/lua/autorun/script.lua')).toBe(false);
    expect(isDownloadableContent('cstrike/logs/L0831.log')).toBe(false);
    expect(isDownloadableContent('loosefile.txt')).toBe(false);
    expect(isDownloadableContent('README')).toBe(false);
  });

  it('rejects denylisted basenames anywhere', () => {
    expect(isDownloadableContent('cstrike/maps/server.cfg')).toBe(false);
    expect(isDownloadableContent('cstrike/sound/motd.txt')).toBe(false);
    expect(isDownloadableContent('cstrike/maps/mapcycle.txt')).toBe(false);
  });

  it('rejects log/demo/temp files inside content dirs', () => {
    expect(isDownloadableContent('cstrike/maps/console.log')).toBe(false);
    expect(isDownloadableContent('cstrike/maps/match.dem')).toBe(false);
    expect(isDownloadableContent('cstrike/models/tmpfile.tmp')).toBe(false);
    expect(isDownloadableContent('cstrike/models/old.bak')).toBe(false);
  });

  it('is case-insensitive for the game dir', () => {
    expect(isDownloadableContent('CSTRIKE/maps/de_dust2.bsp')).toBe(true);
    expect(isDownloadableContent('Cstrike/MAPS/de_dust2.bsp')).toBe(true);
  });

  it('handles path edge cases', () => {
    expect(isDownloadableContent('')).toBe(false);
    expect(isDownloadableContent('/')).toBe(false);
    expect(isDownloadableContent('cstrike//maps//x.bsp')).toBe(true); // double slashes normalized
    expect(isDownloadableContent('cstrike/maps/')).toBe(false); // dir itself, no basename
  });
});

describe('gameDirOf', () => {
  it('extracts the first path segment', () => {
    expect(gameDirOf('cstrike/maps/x.bsp')).toBe('cstrike');
    expect(gameDirOf('garrysmod/sound/x.wav')).toBe('garrysmod');
  });

  it('returns null for bare files', () => {
    expect(gameDirOf('file.txt')).toBeNull();
  });
});

describe('mapToFastdlPath', () => {
  it('places content under fastdl/<gamedir>/<path>', () => {
    expect(mapToFastdlPath('cstrike/maps/de_dust2.bsp')).toBe('fastdl/cstrike/maps/de_dust2.bsp');
    expect(mapToFastdlPath('cstrike/de_chateau.wad')).toBe('fastdl/cstrike/de_chateau.wad');
  });

  it('returns null for non-downloadable files', () => {
    expect(mapToFastdlPath('cstrike/cfg/server.cfg')).toBeNull();
    expect(mapToFastdlPath('cstrike/addons/x.dll')).toBeNull();
  });
});

describe('diffFileLists', () => {
  const stat = (size, mtimeMs) => ({ size, mtimeMs });

  it('detects new files', () => {
    const source = new Map([['cstrike/maps/a.bsp', stat(100, 1)]]);
    const { toCopy, toDelete, unchanged } = diffFileLists(source, {});
    expect(toCopy).toEqual(['cstrike/maps/a.bsp']);
    expect(toDelete).toEqual([]);
    expect(unchanged).toBe(0);
  });

  it('detects changed files by size or mtime', () => {
    const state = {
      'cstrike/maps/a.bsp': stat(100, 1),
      'cstrike/maps/b.bsp': stat(200, 5),
    };
    const source = new Map([
      ['cstrike/maps/a.bsp', stat(150, 1)], // size changed
      ['cstrike/maps/b.bsp', stat(200, 9)], // mtime changed
      ['cstrike/maps/c.bsp', stat(10, 2)], // new
    ]);
    const { toCopy, toDelete, unchanged } = diffFileLists(source, state);
    expect(toCopy.sort()).toEqual(['cstrike/maps/a.bsp', 'cstrike/maps/b.bsp', 'cstrike/maps/c.bsp']);
    expect(toDelete).toEqual([]);
    expect(unchanged).toBe(0);
  });

  it('treats identical stats as unchanged', () => {
    const source = new Map([['cstrike/maps/a.bsp', stat(100, 1)]]);
    const { toCopy, unchanged } = diffFileLists(source, { 'cstrike/maps/a.bsp': stat(100, 1) });
    expect(toCopy).toEqual([]);
    expect(unchanged).toBe(1);
  });

  it('detects deletions (in state, missing from source)', () => {
    const state = {
      'cstrike/maps/gone.bsp': stat(100, 1),
      'cstrike/maps/here.bsp': stat(50, 2),
    };
    const source = new Map([['cstrike/maps/here.bsp', stat(50, 2)]]);
    const { toCopy, toDelete, unchanged } = diffFileLists(source, state);
    expect(toCopy).toEqual([]);
    expect(toDelete).toEqual(['cstrike/maps/gone.bsp']);
    expect(unchanged).toBe(1);
  });
});

describe('buildDownloadUrl', () => {
  it('uses the primary ip and port', () => {
    expect(buildDownloadUrl('203.0.113.7', 27025)).toBe('http://203.0.113.7:27025');
  });

  it('substitutes a placeholder for wildcard binds', () => {
    expect(buildDownloadUrl('0.0.0.0', 27025)).toBe('http://<node-public-ip>:27025');
  });
});
