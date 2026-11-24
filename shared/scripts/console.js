window.onerror = function(msg, url, line, column, error) {
    const message = JSON.stringify({ type: "debug", body: `❌️ ${msg}` });
    webkit.messageHandlers.handler.postMessage(message);
};
window.console.error = function(msg) {
    const message = JSON.stringify({ type: "debug", body: `❌️ ${msg}` });
    webkit.messageHandlers.handler.postMessage(message);
};
window.console.warn = function(msg) {
    const message = JSON.stringify({ type: "debug", body: `⚠️ ${msg}` });
    webkit.messageHandlers.handler.postMessage(message);
};
window.console.info = function(msg) {
    const message = JSON.stringify({ type: "debug", body: `ℹ️ ${msg}` });
    webkit.messageHandlers.handler.postMessage(message);
};
window.console.log = function(msg) {
    const message = JSON.stringify({ type: "debug", body: `ℹ️ ${msg}` });
    webkit.messageHandlers.handler.postMessage(message);
};
