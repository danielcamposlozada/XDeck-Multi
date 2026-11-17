waitForElement("a[aria-label='Profile'], a[data-testid='AppTabBar_Profile_Link']", 0, (element) => {
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
});
