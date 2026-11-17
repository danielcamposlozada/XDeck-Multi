const IN_APP_HOSTS = ['x.com', 'twitter.com'];

function isInAppHost(hostname: string): boolean {
  return IN_APP_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

export type NavigationDecision = 'allow' | 'external' | 'block';

/**
 * What to do when a page navigates its main frame: X pages and the column's own site stay in the
 * column; other web pages open in the default browser; anything else is blocked.
 */
export function decideNavigation(target: string, columnStartUrl: string): NavigationDecision {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return 'block';
  }
  if (url.href === 'about:blank') return 'allow';
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'block';
  if (isInAppHost(url.hostname)) return 'allow';
  try {
    if (url.hostname === new URL(columnStartUrl).hostname) return 'allow';
  } catch {
    // An invalid start URL never matches.
  }
  return 'external';
}

/** Only web links may be handed to the system browser. */
export function isWebUrl(target: string): boolean {
  try {
    const { protocol } = new URL(target);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
