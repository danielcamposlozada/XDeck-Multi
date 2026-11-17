import { join } from 'node:path';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  LOGIN_SCRIPTS,
  buildPageScript,
  columnScripts,
  loadScriptLibrary,
  nightModeScript,
  type ColumnScriptOptions,
} from '../src/main/scripts';

const library = loadScriptLibrary(join(__dirname, '..', '..', 'shared', 'scripts'));

const column: ColumnScriptOptions = {
  type: 'following',
  columnIndex: 2,
  isXColumn: true,
  isLeftMostXColumn: false,
  showsSideHeader: false,
  hideAds: false,
};

describe('columnScripts', () => {
  it('matches ContentView.makeColumn on macOS', () => {
    expect(columnScripts(column).map((script) => script.name)).toEqual([
      'global',
      'detectMediaOverlay',
      'hideSideHeader',
      'hidePostArea',
      'clickFollowingTab',
    ]);
    expect(
      columnScripts({ ...column, type: 'forYou', isLeftMostXColumn: true, showsSideHeader: true, hideAds: true }).map(
        (script) => script.name,
      ),
    ).toEqual(['global', 'detectMediaOverlay', 'findThemeColor', 'hideAds', 'clickForYouTab']);
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
    expect(script).toContain('body: String(2)');
    expect(script).not.toContain('__COLUMN_INDEX__');
  });

  it('is valid JavaScript', () => {
    for (const scripts of [columnScripts({ ...column, hideAds: true }), LOGIN_SCRIPTS]) {
      expect(() => new Script(buildPageScript(library, scripts))).not.toThrow();
    }
    expect(() => new Script(library.showAds)).not.toThrow();
  });

  it('sets the night mode cookie', () => {
    expect(nightModeScript(library, true)).toContain('night_mode=1;');
    expect(nightModeScript(library, false)).toContain('night_mode=0;');
  });
});
