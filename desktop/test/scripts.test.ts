import { join } from 'node:path';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  LOGIN_SCRIPTS,
  buildPageScript,
  columnScripts,
  compactScript,
  loadScriptLibrary,
  nightModeScript,
  type ColumnScriptOptions,
} from '../src/main/scripts';

const library = loadScriptLibrary(join(__dirname, '..', '..', 'shared', 'scripts'));

const column: ColumnScriptOptions = {
  type: 'following',
  columnId: 2,
  isXColumn: true,
  showsSideHeader: false,
  hideAds: false,
};

describe('columnScripts', () => {
  it('matches ContentView.makeColumn on macOS', () => {
    expect(columnScripts(column).map((script) => script.name)).toEqual([
      'global',
      'detectMediaOverlay',
      'findThemeColor',
      'hideBottomBar',
      'videoDownload',
      'hideSideHeader',
      'hidePostArea',
      'clickFollowingTab',
    ]);
    expect(
      columnScripts({ ...column, type: 'forYou', showsSideHeader: true, hideAds: true }).map(
        (script) => script.name,
      ),
    ).toEqual(['global', 'detectMediaOverlay', 'findThemeColor', 'hideBottomBar', 'videoDownload', 'hideAds', 'clickForYouTab']);
    expect(columnScripts({ ...column, type: 'custom', isXColumn: false }).map((script) => script.name)).toEqual([
      'global',
      'detectMediaOverlay',
    ]);
  });
});

describe('buildPageScript', () => {
  it('runs the early scripts first and the rest after the page loads', () => {
    const script = buildPageScript(library, columnScripts(column));
    const onLoad = script.indexOf('const __xdeckOnLoad');
    expect(script.indexOf('window.console.error')).toBeLessThan(onLoad);
    expect(script.indexOf('history.pushState')).toBeLessThan(onLoad);
    expect(script.indexOf("role='tab']\", 1")).toBeGreaterThan(onLoad);
    expect(script.indexOf("role='tab']\", 1")).toBeLessThan(script.indexOf("document.readyState === 'loading'"));
    expect(script).toContain('body: "2"');
    expect(script).not.toContain('__COLUMN_ID__');
  });

  it('is valid JavaScript', () => {
    for (const scripts of [columnScripts({ ...column, hideAds: true }), LOGIN_SCRIPTS]) {
      expect(() => new Script(buildPageScript(library, scripts))).not.toThrow();
    }
    expect(() => new Script(library.showAds)).not.toThrow();
  });

  it('toggles the side navigation in place', () => {
    const hide = compactScript(library, true);
    expect(hide).toContain("getElementById('xdeck-hide-side-header')");
    expect(hide).toContain(library.hideSideHeader);
    expect(() => new Script(hide)).not.toThrow();
    const show = compactScript(library, false);
    expect(show).toContain("getElementById('xdeck-hide-post-area')?.remove()");
    expect(() => new Script(show)).not.toThrow();
  });

  it('sets the night mode cookie', () => {
    expect(nightModeScript(library, true)).toContain('night_mode=1;');
    expect(nightModeScript(library, false)).toContain('night_mode=0;');
  });
});
