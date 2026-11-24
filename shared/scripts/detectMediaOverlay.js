(function() {
    var mediaExpanded = false;
    const originalPushState = history.pushState;
    history.pushState = function() {
        originalPushState.apply(this, arguments);
        const url = window.location.href;
        if (!mediaExpanded && /\/(photo|video)\/\d+/.test(url)) {
            mediaExpanded = true;
            const message = JSON.stringify({ type: "mediaOverlay", body: "__COLUMN_ID__" });
            webkit.messageHandlers.handler.postMessage(message);
        }
    };
    window.addEventListener('popstate', function() {
        const url = window.location.href;
        if (mediaExpanded && !/\/(photo|video)\/\d+/.test(url)) {
            mediaExpanded = false;
            const message = JSON.stringify({ type: "mediaOverlay", body: "close" });
            webkit.messageHandlers.handler.postMessage(message);
        }
    });
})();
