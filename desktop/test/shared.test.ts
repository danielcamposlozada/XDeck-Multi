// Until the macOS edition loads shared/ itself, its copies must stay identical to shared/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCRIPT_FILES } from '../src/main/scripts';

const root = join(__dirname, '..', '..');
const read = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8');

/** Ignores indentation and line breaks, which differ inside Swift string literals. */
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Turns the Swift string literals back into the JavaScript they produce. */
const swiftSource = squash(
  read('XDeck', 'WebViewConfigurations.swift')
    .replaceAll('\\(Self.handlerName)', 'handler')
    .replaceAll('\\(columnID)', '__COLUMN_ID__')
    .replaceAll('\\\\', '\\'),
);
const contentViewSource = squash(read('XDeck', 'View', 'ContentView.swift'));

describe('shared files match the macOS edition', () => {
  it.each(SCRIPT_FILES.filter((name) => name !== 'setNightMode'))('scripts/%s.js', (name) => {
    expect(swiftSource).toContain(squash(read('shared', 'scripts', `${name}.js`)));
  });

  it('scripts/setNightMode.js', () => {
    const script = squash(read('shared', 'scripts', 'setNightMode.js')).replace(
      '__NIGHT_MODE__',
      '\\(isDarkMode ? 1 : 0)',
    );
    expect(contentViewSource).toContain(script);
  });

  it.each(['schema.json', 'settings.json'])('%s', (name) => {
    expect(read('shared', name)).toBe(read('XDeck', 'Config', name));
  });
});
