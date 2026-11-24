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
            }
        }

        var runAfterLoad: Bool {
            switch self {
            case .findUserName, .findThemeColor, .clickForYouTab, .clickFollowingTab, .hideSideHeader, .hidePostArea, .hideAds, .hideBottomBar:
                return true
            case .global, .detectMediaOverlay:
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
        // header: the side navigation of 𝕏's wide layout (older markup).
        // div:has(> nav[data-bottom-bar]): what narrow columns pin to the bottom, the navigation bar and
        // the floating Post button above it. Only the account's first column keeps the Post button.
        style.innerHTML = "header, div:has(> nav[data-bottom-bar]) { display: none !important; }";
        document.querySelector('head').appendChild(style);
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

