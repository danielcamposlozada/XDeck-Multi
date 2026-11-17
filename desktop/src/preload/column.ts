// Preload of every X page (columns and the login screen). Runs sandboxed: only `electron` is
// available.
//
// The shared scripts talk to the app with `webkit.messageHandlers.handler.postMessage(...)`, the
// WebKit API the macOS edition uses. This exposes the same call and forwards it over IPC, so the
// scripts run unchanged in both editions.
import { contextBridge, ipcRenderer, webFrame } from 'electron';

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    handler: {
      postMessage(message: unknown): void {
        if (typeof message === 'string') ipcRenderer.send('xdeck:page-message', message);
      },
    },
  },
});

// The main process builds this page's script (it depends on the column and on Hide Ads).
const script: unknown = ipcRenderer.sendSync('xdeck:page-script');
if (typeof script === 'string' && script.length > 0) {
  // Runs in the page's own world, like a WKUserScript at document start.
  void webFrame.executeJavaScript(script);
}

/** Whether the wheel event can scroll something sideways inside the page. */
function canScrollHorizontally(target: EventTarget | null, deltaX: number): boolean {
  let element = target instanceof Element ? target : null;
  while (element !== null) {
    const { overflowX } = getComputedStyle(element);
    if (
      (overflowX === 'auto' || overflowX === 'scroll') &&
      element.scrollWidth > element.clientWidth
    ) {
      const atStart = element.scrollLeft <= 0;
      const atEnd = element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
      if ((deltaX < 0 && !atStart) || (deltaX > 0 && !atEnd)) return true;
    }
    element = element.parentElement;
  }
  return false;
}

// Sideways scrolling over a column scrolls the row of columns, like the macOS ScrollView.
window.addEventListener(
  'wheel',
  (event) => {
    const deltaX = event.deltaX;
    if (Math.abs(deltaX) <= Math.abs(event.deltaY) || deltaX === 0) return;
    if (canScrollHorizontally(event.target, deltaX)) return;
    ipcRenderer.send('xdeck:scroll-by', deltaX);
  },
  { passive: true },
);
