// Preload for the embedded ComfyUI WebContentsView.
//
// Purpose: forward ComfyUI's own WebSocket events (progress / executing / preview
// images) to the Image MetaHub renderer, WITHOUT opening a second WebSocket.
// ComfyUI only routes those events to the socket that owns the prompt's client_id
// and never broadcasts them, and reusing that client_id from a second socket would
// evict the embedded UI's own connection. So instead of connecting, we passively
// observe the socket the page already has and relay what we see over IPC.
//
// This view runs with contextIsolation: false, so this preload executes in the
// page's MAIN world at document start — before ComfyUI creates its socket. That
// lets us wrap window.WebSocket in time (an executeJavaScript-on-dom-ready patch
// lands too late) and forward frames straight over ipcRenderer (no postMessage,
// no page CSP involved). We expose nothing to the page and only read traffic;
// ipcRenderer stays in this module's scope, unreachable from page code.

const { ipcRenderer } = require('electron');

const CHANNEL = 'comfy-embedded-ws-event';
const FORWARDED_TYPES = new Set([
  'progress',
  'progress_state',
  'executing',
  'execution_error',
  'execution_interrupted',
]);

(function installWebSocketObserver() {
  try {
    if (window.__imhWsObserverInstalled) {
      return;
    }
    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket !== 'function') {
      return;
    }
    window.__imhWsObserverInstalled = true;

    const observe = (socket) => {
      try {
        socket.addEventListener('message', (event) => {
          try {
            const data = event.data;
            if (typeof data === 'string') {
              let message;
              try {
                message = JSON.parse(data);
              } catch (_error) {
                return;
              }
              if (message && FORWARDED_TYPES.has(message.type)) {
                ipcRenderer.send(CHANNEL, { kind: 'json', payload: message });
              }
            } else if (data instanceof ArrayBuffer) {
              ipcRenderer.send(CHANNEL, { kind: 'binary', buffer: data.slice(0) });
            } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
              data.arrayBuffer()
                .then((buffer) => ipcRenderer.send(CHANNEL, { kind: 'binary', buffer }))
                .catch(() => {});
            }
          } catch (_error) {
            // Ignore malformed frames.
          }
        });
      } catch (_error) {
        // Ignore sockets we cannot observe.
      }
    };

    function ObservedWebSocket(url, protocols) {
      const socket = protocols !== undefined
        ? new NativeWebSocket(url, protocols)
        : new NativeWebSocket(url);
      observe(socket);
      return socket;
    }

    ObservedWebSocket.prototype = NativeWebSocket.prototype;
    ObservedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
    ObservedWebSocket.OPEN = NativeWebSocket.OPEN;
    ObservedWebSocket.CLOSING = NativeWebSocket.CLOSING;
    ObservedWebSocket.CLOSED = NativeWebSocket.CLOSED;

    window.WebSocket = ObservedWebSocket;
  } catch (_error) {
    // If the constructor cannot be replaced there is nothing more we can do.
  }
})();
