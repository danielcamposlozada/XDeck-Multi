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
