import CryptoKit
import Foundation
import WebKit

/// One persistent, isolated WebKit session per account named in settings.json, so each account
/// keeps its own cookies and login. Columns without an account use the default session, which
/// keeps existing logins working.
enum AccountSessions {
    private static var dataStores: [String: WKWebsiteDataStore] = [:]

    static func dataStore(for accountKey: String) -> WKWebsiteDataStore {
        if accountKey.isEmpty {
            return .default()
        }
        if let dataStore = dataStores[accountKey] {
            return dataStore
        }
        let dataStore: WKWebsiteDataStore
        if #available(macOS 14.0, *) {
            dataStore = WKWebsiteDataStore(forIdentifier: identifier(for: accountKey))
        } else {
            // Persistent per-account sessions need macOS 14. On older systems the session
            // lasts until the app quits.
            dataStore = .nonPersistent()
        }
        dataStores[accountKey] = dataStore
        return dataStore
    }

    /// A stable UUID for an account key, so the same key always reopens the same session.
    private static func identifier(for accountKey: String) -> UUID {
        var bytes = Array(SHA256.hash(data: Data("XDeck.account.\(accountKey)".utf8)).prefix(16))
        bytes[6] = (bytes[6] & 0x0F) | 0x50 // version 5 (name-based)
        bytes[8] = (bytes[8] & 0x3F) | 0x80 // RFC 4122 variant
        return NSUUID(uuidBytes: bytes) as UUID
    }
}

struct WebViewConfigurations {
    enum OnLoadScript {
        case global
        case findUserName
        case findThemeColor
        case clickForYouTab
        case hidePostArea
        case clickFollowingTab
        case hideSideHeader
        case hideAds
        case hideBottomBar
        case detectMediaOverlay(columnID: String)
        case videoDownload

        var scriptContent: String {
            switch self {
            case .global: return WebViewConfigurations.global
            case .findUserName: return WebViewConfigurations.findUserName
            case .findThemeColor: return WebViewConfigurations.findThemeColor
            case .clickForYouTab: return WebViewConfigurations.clickForYouTab
            case .hidePostArea: return WebViewConfigurations.hidePostArea
            case .clickFollowingTab: return WebViewConfigurations.clickFollowingTab
            case .hideSideHeader: return WebViewConfigurations.hideSideHeader
            case .hideAds: return WebViewConfigurations.hideAds
            case .hideBottomBar: return WebViewConfigurations.hideBottomBar
            case .detectMediaOverlay(let columnID): return WebViewConfigurations.detectMediaOverlay(columnID: columnID)
            case .videoDownload: return WebViewConfigurations.videoDownload
            }
        }

        var runAfterLoad: Bool {
            switch self {
            case .findUserName, .findThemeColor, .clickForYouTab, .clickFollowingTab, .hideSideHeader, .hidePostArea, .hideAds, .hideBottomBar:
                return true
            case .global, .detectMediaOverlay, .videoDownload:
                return false
            }
        }
    }

    static let handlerName = "handler";

    static func makeConfiguration(onLoadScripts: [OnLoadScript], accountKey: String = "") -> WKWebViewConfiguration {
        let script = [
            onLoadScripts.filter({ !$0.runAfterLoad }).map(\.scriptContent).joined(separator: "\n"),
            wrapOnLoad(contents: onLoadScripts.filter({ $0.runAfterLoad }).map(\.scriptContent)),
        ].joined(separator: "\n")
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = AccountSessions.dataStore(for: accountKey)
        let userContentController = WKUserContentController()
        configuration.userContentController = userContentController
        let userScript = WKUserScript(
            source: script,
            injectionTime: .atDocumentStart, forMainFrameOnly: true)
        userContentController.addUserScript(userScript)
        return configuration
    }

    private static let global: String = """
        window.onerror = function(msg, url, line, column, error) {
            const message = JSON.stringify({ type: "debug", body: `❌️ ${msg}` });
            webkit.messageHandlers.\(Self.handlerName).postMessage(message);
        };
        window.console.error = function(msg) {
            const message = JSON.stringify({ type: "debug", body: `❌️ ${msg}` });
            webkit.messageHandlers.\(Self.handlerName).postMessage(message);
        };
        window.console.warn = function(msg) {
            const message = JSON.stringify({ type: "debug", body: `⚠️ ${msg}` });
            webkit.messageHandlers.\(Self.handlerName).postMessage(message);
        };
        window.console.info = function(msg) {
            const message = JSON.stringify({ type: "debug", body: `ℹ️ ${msg}` });
            webkit.messageHandlers.\(Self.handlerName).postMessage(message);
        };
        window.console.log = function(msg) {
            const message = JSON.stringify({ type: "debug", body: `ℹ️ ${msg}` });
            webkit.messageHandlers.\(Self.handlerName).postMessage(message);
        };

        \(getElementsByXPath)

        \(waitForElement)
    """

    private static let hidePostArea: String = """
        const style = document.createElement('style');
        style.type = 'text/css';
        style.id = 'xdeck-hide-post-area';
        style.innerHTML = "div:has(> main):has(> :nth-child(4)) > main div:has(> div > div[role='progressbar']) { display: none; }";
        document.querySelector('head').appendChild(style);
    """

    private static let findUserName: String = """
        (() => {
            // Paths in 𝕏's side navigation that aren't a profile.
            const reservedPaths = new Set([
                "home", "explore", "search", "notifications", "messages", "settings", "compose",
                "i", "jobs", "communities", "bookmarks", "lists", "login", "logout", "tos", "privacy"
            ]);
            // 𝕏 used to tag the profile link with a test id or an English label. It no longer does,
            // and the label follows the UI language, so fall back to the side navigation link that
            // points at a bare username ("/name").
            const findProfileLink = () => {
                const tagged = document.querySelector("a[data-testid='AppTabBar_Profile_Link'], a[aria-label='Profile']");
                if (tagged) return tagged;
                return [...document.querySelectorAll("nav a[href]")].find((link) => {
                    const match = (link.getAttribute('href') || '').match(/^\\/([A-Za-z0-9_]{1,15})$/);
                    return match && !reservedPaths.has(match[1].toLowerCase());
                });
            };
            const report = (element) => {
                const href = element.getAttribute('href') || element.href || '';
                let userName = null;
                try {
                    const url = new URL(href, window.location.origin);
                    const segments = url.pathname.split('/').filter(Boolean);
                    userName = segments[0] || null;
                } catch (_) {}
                if (userName) {
                    const message = JSON.stringify({ type: "userName", body: userName });
                    webkit.messageHandlers.\(Self.handlerName).postMessage(message);
                }
            };
            const found = findProfileLink();
            if (found) {
                report(found);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = findProfileLink();
                if (element) {
                    observer.disconnect();
                    report(element);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        })();
    """

    private static let findThemeColor: String = """
        waitForElement("meta[name='theme-color']", 0, (meta) => {
            // The theme-color meta tag can be rewritten multiple times while the SPA hydrates
            // (e.g. a default value first, then the value derived from the night_mode cookie),
            // so wait for it to stop changing before reporting it back.
            let debounceTimer = null;
            const reportWhenStable = () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    const message = JSON.stringify({ type: "themeColor", body: meta.getAttribute('content') });
                    webkit.messageHandlers.\(Self.handlerName).postMessage(message);
                }, 500);
            };
            new MutationObserver(reportWhenStable).observe(meta, { attributes: true, attributeFilter: ['content'] });
            reportWhenStable();
        });
    """

    private static let hideSideHeader: String = """
        const style = document.createElement('style');
        style.type = 'text/css';
        style.id = 'xdeck-hide-side-header';
        // header: the side navigation of 𝕏's wide layout (older markup).
        // div:has(> nav[data-bottom-bar]): what narrow columns pin to the bottom, the navigation bar and
        // the floating Post button above it. Only the account's first column keeps the Post button.
        style.innerHTML = "header, div:has(> nav[data-bottom-bar]) { display: none !important; }";
        document.querySelector('head').appendChild(style);
        """

    /// Ids of the styles that hideSideHeader and hidePostArea add, so they can be taken out again.
    private static let compactStyleIDs = ["xdeck-hide-side-header", "xdeck-hide-post-area"]

    /// Shows or hides 𝕏's side navigation and post area on the page already loaded, without a
    /// reload, for a column whose role changed because the columns moved.
    static func setCompactScript(_ isCompact: Bool) -> String {
        if isCompact {
            return """
                if (!document.getElementById('\(compactStyleIDs[0])')) {
                    (() => { \(hideSideHeader) })();
                    (() => { \(hidePostArea) })();
                }
                """
        }
        return compactStyleIDs.map { "document.getElementById('\($0)')?.remove();" }.joined(separator: "\n")
    }

    // Adds a download button to 𝕏 videos and GIFs. Runs at document start, so it sees the API
    // responses that list each video's MP4 files (shared/scripts/videoDownload.js).
    private static let videoDownload: String = """
        (() => {
            if (window.__xdeckVideos) return;
            // Video and GIF files 𝕏 lists in its own API responses, by media key: the best MP4 of each.
            const videos = new Map();
            window.__xdeckVideos = videos;

            // The key is in both the poster image and the video file addresses:
            // ext_tw_video(_thumb)/ID/, amplify_video(_thumb)/ID/ and tweet_video(_thumb)/KEY for GIFs.
            const patterns = [
                new RegExp('(?:ext_tw_video|amplify_video)(?:_thumb)?/([0-9]+)/'),
                new RegExp('tweet_video(?:_thumb)?/([A-Za-z0-9_-]+)'),
            ];
            const keyFromUrl = (url) => {
                for (const pattern of patterns) {
                    const match = (url || '').match(pattern);
                    if (match) return match[1];
                }
                return null;
            };

            const remember = (media) => {
                const variants = ((media.video_info || {}).variants || []).filter(
                    (variant) => variant.content_type === 'video/mp4' && variant.url
                );
                if (variants.length === 0) return;
                const best = variants.reduce((a, b) => ((b.bitrate || 0) > (a.bitrate || 0) ? b : a));
                const key = keyFromUrl(media.media_url_https) || keyFromUrl(best.url) || media.id_str;
                if (!key) return;
                // expanded_url is https://x.com/USER/status/ID/video/1: name the file after them.
                const parts = (media.expanded_url || '').split('/');
                const statusIndex = parts.indexOf('status');
                const name = statusIndex > 0 && parts[statusIndex + 1]
                    ? parts[statusIndex - 1] + '-' + parts[statusIndex + 1]
                    : key;
                videos.set(key, { url: best.url, name: name });
            };

            const scan = (value, depth) => {
                if (!value || typeof value !== 'object' || depth > 80) return;
                if (Array.isArray(value)) {
                    value.forEach((item) => scan(item, depth + 1));
                    return;
                }
                if (value.video_info && typeof value.video_info === 'object') remember(value);
                for (const key in value) {
                    const child = value[key];
                    if (child && typeof child === 'object') scan(child, depth + 1);
                }
            };

            let pending = false;
            const scheduleButtons = () => {
                if (pending) return;
                pending = true;
                setTimeout(() => {
                    pending = false;
                    addButtons();
                }, 300);
            };

            const inspectText = (text) => {
                if (typeof text !== 'string' || text.indexOf('video_info') === -1) return;
                try {
                    scan(JSON.parse(text), 0);
                } catch (_) {}
                scheduleButtons();
            };

            const originalSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function () {
                this.addEventListener('load', () => {
                    try {
                        if (this.responseType === '' || this.responseType === 'text') {
                            inspectText(this.responseText);
                        } else if (this.responseType === 'json' && this.response) {
                            scan(this.response, 0);
                            scheduleButtons();
                        }
                    } catch (_) {}
                });
                return originalSend.apply(this, arguments);
            };
            const originalFetch = window.fetch;
            window.fetch = function () {
                return originalFetch.apply(this, arguments).then((response) => {
                    try {
                        const type = response.headers.get('content-type') || '';
                        if (type.indexOf('json') !== -1) {
                            response.clone().text().then(inspectText).catch(() => {});
                        }
                    } catch (_) {}
                    return response;
                });
            };

            const svgNamespace = 'http://www.w3.org/2000/svg';
            const iconPaths = {
                download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14',
                done: 'm6 12.5 4 4 8-9',
                failed: 'M12 7v6M12 17h.01',
            };
            const makeIcon = (name) => {
                const svg = document.createElementNS(svgNamespace, 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '18');
                svg.setAttribute('height', '18');
                svg.setAttribute('aria-hidden', 'true');
                const path = document.createElementNS(svgNamespace, 'path');
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', 'currentColor');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('stroke-linecap', 'round');
                path.setAttribute('stroke-linejoin', 'round');
                path.setAttribute('d', iconPaths[name]);
                svg.appendChild(path);
                return svg;
            };

            // What the app reports about each download, by video address: downloading (with the share
            // done so far, or null when the size is unknown), done or failed.
            const states = new Map();
            const paint = (button) => {
                const status = states.get(button.dataset.url);
                button.classList.remove('xdeck-downloading', 'xdeck-done', 'xdeck-failed');
                while (button.firstChild) button.removeChild(button.firstChild);
                let label = 'Download video';
                if (status && status.state === 'downloading') {
                    button.classList.add('xdeck-downloading');
                    const fraction = typeof status.fraction === 'number' ? status.fraction : null;
                    button.style.setProperty('--xdeck-progress', String(fraction === null ? 0.25 : fraction));
                    const text = document.createElement('span');
                    text.textContent = fraction === null ? '…' : Math.round(fraction * 100) + '%';
                    button.appendChild(text);
                    label = fraction === null ? 'Downloading video' : 'Downloading video, ' + Math.round(fraction * 100) + '%';
                } else if (status && status.state === 'done') {
                    button.classList.add('xdeck-done');
                    button.appendChild(makeIcon('done'));
                    label = 'Saved to Downloads. Click to download again';
                } else if (status && status.state === 'failed') {
                    button.classList.add('xdeck-failed');
                    button.appendChild(makeIcon('failed'));
                    label = 'Download failed. Click to try again';
                } else {
                    button.appendChild(makeIcon('download'));
                }
                button.title = label;
                button.setAttribute('aria-label', label);
            };
            // Called by the app whenever a download moves on.
            window.__xdeckDownloadStates = (all) => {
                states.clear();
                Object.keys(all || {}).forEach((url) => states.set(url, all[url]));
                document.querySelectorAll('.xdeck-download').forEach(paint);
            };

            const addButtons = () => {
                document.querySelectorAll('video').forEach((video) => {
                    const key = keyFromUrl(video.getAttribute('poster')) || keyFromUrl(video.getAttribute('src'));
                    const info = key ? videos.get(key) : null;
                    const player = video.closest('[data-testid="videoPlayer"]') || video.parentElement;
                    if (!info || !player || player.querySelector('.xdeck-download')) return;
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'xdeck-download';
                    button.dataset.url = info.url;
                    paint(button);
                    // 𝕏 plays or opens the video on press; the button keeps its clicks to itself.
                    ['pointerdown', 'mousedown', 'mouseup', 'touchstart'].forEach((type) => {
                        button.addEventListener(type, (event) => event.stopPropagation(), true);
                    });
                    button.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const status = states.get(info.url);
                        if (status && status.state === 'downloading') return;
                        // Shows the download starting right away; the app reports the rest.
                        states.set(info.url, { state: 'downloading', fraction: null });
                        paint(button);
                        const message = JSON.stringify({
                            type: 'downloadVideo',
                            body: JSON.stringify({ url: info.url, name: info.name }),
                        });
                        webkit.messageHandlers.handler.postMessage(message);
                    }, true);
                    if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
                    player.appendChild(button);
                });
            };

            const start = () => {
                const style = document.createElement('style');
                style.type = 'text/css';
                style.innerHTML = '.xdeck-download { position: absolute; top: 8px; right: 8px; z-index: 10; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: rgba(15, 20, 25, 0.75); color: #fff; cursor: pointer; opacity: 0.85; transition: opacity 0.15s, transform 0.15s; } .xdeck-download:hover { opacity: 1; transform: scale(1.06); } .xdeck-download:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 2px; } .xdeck-download span { font: 700 10px/1 system-ui, sans-serif; } .xdeck-download.xdeck-downloading { opacity: 1; background: radial-gradient(circle, rgba(15, 20, 25, 0.9) 57%, transparent 59%), conic-gradient(#1d9bf0 calc(var(--xdeck-progress, 0) * 360deg), rgba(255, 255, 255, 0.3) 0); } .xdeck-download.xdeck-done { opacity: 1; background: #00ba7c; } .xdeck-download.xdeck-failed { opacity: 1; background: #f4a100; }';
                document.head.appendChild(style);
                new MutationObserver(scheduleButtons).observe(document.body, { childList: true, subtree: true });
                scheduleButtons();
            };
            if (document.body) {
                start();
            } else {
                document.addEventListener('DOMContentLoaded', start);
            }
        })();
        """

    // 𝕏's main navigation, which narrow columns show as an iPhone-style bar pinned to the bottom.
    // It overlaps the last post and repeats what the first column's header already offers.
    private static let hideBottomBar: String = """
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = "nav[data-bottom-bar] { display: none !important; }";
        document.querySelector('head').appendChild(style);
        """

    private static let clickForYouTab: String = """
        waitForElement("a[href='/home'][role='tab']", 0, (element) => {
            element.click();
        });
        """

    private static let clickFollowingTab: String = """
        waitForElement("a[href='/home'][role='tab']", 1, (element) => {
            element.click();
        });
        """

    private static func wrapOnLoad(contents: [String]) -> String {
        return """
            \(waitForElement)
            document.addEventListener('DOMContentLoaded', () => {
                \(contents.map {
                    """
                    (() => {
                        \($0)
                    })();
                    """
                }.joined(separator: "\n"))
            });
            """
    }

    private static let waitForElement: String = """
        function waitForElement(selector, index, callback, once=true) {
            const observer = new MutationObserver((mutationsList, observer) => {
                const element = document.querySelectorAll(selector)[index];
                if (element) {
                    callback(element);
                    if (once) {
                        observer.disconnect();
                    }
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
        """

    private static let getElementsByXPath: String = """
        function getElementsByXPath(xpath, parent) {
          let results = [];
          let query = document.evaluate(
            xpath,
            parent || document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
          );
          for (let i = 0, length = query.snapshotLength; i < length; i++) {
            results.push(query.snapshotItem(i));
          }
          return results;
        }
        """

    static let hideAds: String = """
        function hideAds() {
          const cells = document.querySelectorAll('div[data-testid="cellInnerDiv"]');
          cells.forEach((cell) => {
            // Ads carry *-impression-pixel elements; placementTracking alone also wraps regular video tweets
            if (cell.querySelector('[data-testid$="-impression-pixel"]')) {
              cell.style.display = "none";
            }
          });
        }

        if (!window.hideAdsMutationObserver) {
          let hideAdsTimer;
          let observer = new MutationObserver(() => {
            clearTimeout(hideAdsTimer);
            hideAdsTimer = setTimeout(hideAds, 100);
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true,
          });

          window.hideAdsMutationObserver = observer;
        }

        hideAds();
        """

    static let showAds: String = """
        (() => {
          if (window.hideAdsMutationObserver) {
            window.hideAdsMutationObserver.disconnect();
            window.hideAdsMutationObserver = null;
          }

          const cells = document.querySelectorAll('div[data-testid="cellInnerDiv"]');
          cells.forEach((cell) => {
            if (cell.querySelector('[data-testid$="-impression-pixel"]')) {
              cell.style.display = "flex";
            }
          });
        })();
    """

    private static func detectMediaOverlay(columnID: String) -> String {
        return """
            (function() {
                var mediaExpanded = false;
                const originalPushState = history.pushState;
                history.pushState = function() {
                    originalPushState.apply(this, arguments);
                    const url = window.location.href;
                    if (!mediaExpanded && /\\/(photo|video)\\/\\d+/.test(url)) {
                        mediaExpanded = true;
                        const message = JSON.stringify({ type: "mediaOverlay", body: "\(columnID)" });
                        webkit.messageHandlers.\(Self.handlerName).postMessage(message);
                    }
                };
                window.addEventListener('popstate', function() {
                    const url = window.location.href;
                    if (mediaExpanded && !/\\/(photo|video)\\/\\d+/.test(url)) {
                        mediaExpanded = false;
                        const message = JSON.stringify({ type: "mediaOverlay", body: "close" });
                        webkit.messageHandlers.\(Self.handlerName).postMessage(message);
                    }
                });
            })();
        """
    }
}

