// Builds the script injected into each page from shared/scripts, in the same order and with the
// same timing as WebViewConfigurations.makeConfiguration in the macOS edition.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ColumnType } from './config';

export const SCRIPT_FILES = [
  'console',
  'getElementsByXPath',
  'waitForElement',
  'findUserName',
  'findThemeColor',
  'clickForYouTab',
  'clickFollowingTab',
  'hidePostArea',
  'hideSideHeader',
  'hideBottomBar',
  'hideAds',
  'showAds',
  'detectMediaOverlay',
  'videoDownload',
  'setNightMode',
] as const;
export type ScriptFile = (typeof SCRIPT_FILES)[number];
export type ScriptLibrary = Readonly<Record<ScriptFile, string>>;

export function loadScriptLibrary(directory: string): ScriptLibrary {
  const entries = SCRIPT_FILES.map((name) => [
    name,
    readFileSync(join(directory, `${name}.js`), 'utf8'),
  ]);
  return Object.fromEntries(entries) as Record<ScriptFile, string>;
}

export type OnLoadScript =
  | { name: 'global' }
  | { name: 'findUserName' }
  | { name: 'findThemeColor' }
  | { name: 'clickForYouTab' }
  | { name: 'clickFollowingTab' }
  | { name: 'hidePostArea' }
  | { name: 'hideSideHeader' }
  | { name: 'hideBottomBar' }
  | { name: 'hideAds' }
  | { name: 'videoDownload' }
  | { name: 'detectMediaOverlay'; columnId: number };

/** Scripts that wait for DOMContentLoaded; the rest run as soon as the page starts. */
function runsAfterLoad(script: OnLoadScript): boolean {
  return script.name !== 'global' && script.name !== 'detectMediaOverlay' && script.name !== 'videoDownload';
}

function contentOf(library: ScriptLibrary, script: OnLoadScript): string {
  switch (script.name) {
    case 'global':
      return [library.console, library.getElementsByXPath, library.waitForElement].join('\n');
    case 'detectMediaOverlay':
      // Columns are identified by an id that stays the same when they move, like on macOS.
      return library.detectMediaOverlay.replaceAll('__COLUMN_ID__', String(script.columnId));
    default:
      return library[script.name];
  }
}

export function buildPageScript(library: ScriptLibrary, scripts: readonly OnLoadScript[]): string {
  const early = scripts.filter((script) => !runsAfterLoad(script));
  const late = scripts.filter(runsAfterLoad);
  const lateBody = late
    .map((script) => `(() => {\n${contentOf(library, script)}\n})();`)
    .join('\n');
  // The preload may run after DOMContentLoaded on fast loads, so run right away in that case.
  const onLoad = [
    library.waitForElement,
    `const __xdeckOnLoad = () => {\n${lateBody}\n};`,
    "if (document.readyState === 'loading') {",
    "    document.addEventListener('DOMContentLoaded', __xdeckOnLoad);",
    '} else {',
    '    __xdeckOnLoad();',
    '}',
  ].join('\n');
  // Wrapped in a block so the page's own globals can't clash with the helper names.
  return [early.map((script) => contentOf(library, script)).join('\n'), `{\n${onLoad}\n}`].join(
    '\n',
  );
}

export interface ColumnScriptOptions {
  type: ColumnType;
  columnId: number;
  isXColumn: boolean;
  showsSideHeader: boolean;
  hideAds: boolean;
}

/** The scripts of a column (ContentView.makeColumn in the macOS edition). */
export function columnScripts(options: ColumnScriptOptions): OnLoadScript[] {
  const scripts: OnLoadScript[] = [
    { name: 'global' },
    { name: 'detectMediaOverlay', columnId: options.columnId },
  ];
  if (options.isXColumn) {
    // Every X column reports the theme (they all share it), so none has to reload when a
    // different column becomes the leftmost.
    scripts.push({ name: 'findThemeColor' }, { name: 'hideBottomBar' }, { name: 'videoDownload' });
    if (!options.showsSideHeader) {
      scripts.push({ name: 'hideSideHeader' }, { name: 'hidePostArea' });
    }
  }
  if (options.hideAds) scripts.push({ name: 'hideAds' });
  if (options.type === 'forYou') scripts.push({ name: 'clickForYouTab' });
  if (options.type === 'following') scripts.push({ name: 'clickFollowingTab' });
  return scripts;
}

/** The scripts of the login screen (LoginView in the macOS edition). */
export const LOGIN_SCRIPTS: readonly OnLoadScript[] = [
  { name: 'findUserName' },
  { name: 'findThemeColor' },
];

export function nightModeScript(library: ScriptLibrary, isDarkMode: boolean): string {
  return library.setNightMode.replaceAll('__NIGHT_MODE__', isDarkMode ? '1' : '0');
}

/** Ids of the styles hideSideHeader and hidePostArea add (see shared/scripts). */
const COMPACT_STYLE_IDS = ['xdeck-hide-side-header', 'xdeck-hide-post-area'] as const;

/**
 * Shows or hides X's side navigation and post area on a page that is already open, for a column
 * whose role changed because the columns moved. No reload needed.
 */
export function compactScript(library: ScriptLibrary, isCompact: boolean): string {
  if (!isCompact) {
    return COMPACT_STYLE_IDS.map((id) => `document.getElementById('${id}')?.remove();`).join('\n');
  }
  return [
    `if (!document.getElementById('${COMPACT_STYLE_IDS[0]}')) {`,
    `(() => {\n${library.hideSideHeader}\n})();`,
    `(() => {\n${library.hidePostArea}\n})();`,
    '}',
  ].join('\n');
}
