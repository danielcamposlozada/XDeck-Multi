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
            const match = (link.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})$/);
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
            webkit.messageHandlers.handler.postMessage(message);
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
