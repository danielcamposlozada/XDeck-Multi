// Preload of the host page (toolbar, login banner, scroll bar). Runs sandboxed.
import { contextBridge, ipcRenderer } from 'electron';

const api: XDeckHostApi = {
  onState(callback) {
    ipcRenderer.on('xdeck:host-state', (_event, state: XDeckIpc.HostState) => {
      callback(state);
    });
  },
  onScrollBy(callback) {
    ipcRenderer.on('xdeck:host-scroll-by', (_event, deltaX: number) => {
      callback(deltaX);
    });
  },
  send(action) {
    ipcRenderer.send('xdeck:host-action', action);
  },
  reportLayout(layout) {
    ipcRenderer.send('xdeck:host-layout', layout);
  },
  reportDragFrame(frame) {
    ipcRenderer.send('xdeck:host-drag-frame', frame);
  },
};

contextBridge.exposeInMainWorld('xdeckHost', api);
