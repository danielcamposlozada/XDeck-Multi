waitForElement("meta[name='theme-color']", 0, (meta) => {
    // The theme-color meta tag can be rewritten multiple times while the SPA hydrates
    // (e.g. a default value first, then the value derived from the night_mode cookie),
    // so wait for it to stop changing before reporting it back.
    let debounceTimer = null;
    const reportWhenStable = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const message = JSON.stringify({ type: "themeColor", body: meta.getAttribute('content') });
            webkit.messageHandlers.handler.postMessage(message);
        }, 500);
    };
    new MutationObserver(reportWhenStable).observe(meta, { attributes: true, attributeFilter: ['content'] });
    reportWhenStable();
});
