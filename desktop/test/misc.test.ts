import { describe, expect, it } from 'vitest';
import { decideNavigation, isWebUrl } from '../src/main/navigation';
import { clampZoom, isDarkThemeColor, normalizeThemeColor, parsePrefs } from '../src/main/prefs';
import { extractVersion, isNewerVersion } from '../src/main/version';

describe('version', () => {
  it('reads MAJOR.MINOR.PATCH tags, and the older MAJOR.MINOR ones', () => {
    expect(extractVersion('https://github.com/a/b/releases/tag/1.0.1')).toBe('1.0.1');
    expect(extractVersion('https://github.com/a/b/releases/tag/1.2')).toBe('1.2');
    expect(extractVersion('https://github.com/a/b/releases')).toBe('0.0');
  });

  it('compares versions numerically', () => {
    expect(isNewerVersion('1.10', '1.9')).toBe(true);
    expect(isNewerVersion('1.0', '1.0')).toBe(false);
    expect(isNewerVersion('0.0', '1.0')).toBe(false);
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });
});

describe('navigation', () => {
  it('keeps X in the column and sends other sites to the browser', () => {
    expect(decideNavigation('https://x.com/home', 'https://x.com/home')).toBe('allow');
    expect(decideNavigation('https://mobile.twitter.com/a', 'https://x.com/home')).toBe('allow');
    expect(decideNavigation('https://example.com/a', 'https://example.com/')).toBe('allow');
    expect(decideNavigation('https://t.co/abc', 'https://x.com/home')).toBe('external');
    expect(decideNavigation('https://evilx.com/', 'https://x.com/home')).toBe('external');
    expect(decideNavigation('file:///etc/passwd', 'https://x.com/home')).toBe('block');
    expect(decideNavigation('javascript:alert(1)', 'https://x.com/home')).toBe('block');
  });

  it('only opens web links in the browser', () => {
    expect(isWebUrl('https://example.com')).toBe(true);
    expect(isWebUrl('smb://server/share')).toBe(false);
  });
});

describe('prefs', () => {
  it('falls back to the defaults', () => {
    expect(parsePrefs(null)).toEqual({ pageZoom: 1, isDarkMode: false, hideAds: false });
    expect(parsePrefs('garbage')).toEqual({ pageZoom: 1, isDarkMode: false, hideAds: false });
    expect(parsePrefs('{"pageZoom": 9, "isDarkMode": true, "hideAds": "yes"}')).toEqual({
      pageZoom: 3,
      isDarkMode: true,
      hideAds: false,
    });
  });

  it('keeps the zoom in steps of 0.1', () => {
    expect(clampZoom(1 + 0.2 + 0.2)).toBe(1.4);
    expect(clampZoom(0)).toBe(0.4);
  });

  it('reads the theme color like the macOS edition', () => {
    expect(normalizeThemeColor('#ffffff')).toBe('#FFFFFF');
    expect(normalizeThemeColor('red; background: url(x)')).toBeNull();
    expect(isDarkThemeColor('#FFFFFF')).toBe(false);
    expect(isDarkThemeColor('#000000')).toBe(true);
    expect(isDarkThemeColor('#15202B')).toBe(true);
  });
});
