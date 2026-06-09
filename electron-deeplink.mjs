import electron from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const { app, BrowserWindow } = electron;
const SCHEME = 'imagemetahub';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isDeepLink(value) {
  return typeof value === 'string' && value.toLowerCase().startsWith(`${SCHEME}://`);
}

function findDeepLink(args) {
  return Array.from(args || []).find(isDeepLink) || null;
}

function getDirectoryFromLink(value) {
  if (!isDeepLink(value)) return null;
  try {
    const url = new URL(value);
    const rawPath = url.searchParams.get('path') || url.searchParams.get('dir') || url.searchParams.get('directory');
    return rawPath ? path.resolve(rawPath) : null;
  } catch (error) {
    console.warn('[ImageMetaHub protocol] Invalid URL:', error);
    return null;
  }
}

function getDirectoryFromArgs(args) {
  return getDirectoryFromLink(findDeepLink(args));
}

function focusMainWindow() {
  const target = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  if (!target) return null;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  return target;
}

function sendDirectoryToRenderer(directoryPath, attempt = 0) {
  if (!directoryPath) return;
  const target = focusMainWindow();
  if (!target || target.webContents.isLoading()) {
    if (attempt < 120) {
      setTimeout(() => sendDirectoryToRenderer(directoryPath, attempt + 1), 250);
    }
    return;
  }
  target.webContents.send('load-directory-from-cli', directoryPath);
}

function registerProtocol() {
  try {
    if (process.defaultApp) {
      const entry = process.argv[1] ? path.resolve(process.argv[1]) : path.join(__dirname, 'electron-deeplink.mjs');
      return app.setAsDefaultProtocolClient(SCHEME, process.execPath, [entry]);
    }
    return app.setAsDefaultProtocolClient(SCHEME);
  } catch (error) {
    console.warn('[ImageMetaHub protocol] Registration failed:', error);
    return false;
  }
}

const lock = app.requestSingleInstanceLock();

if (!lock) {
  app.quit();
} else {
  registerProtocol();

  const startupDirectory = getDirectoryFromArgs(process.argv);
  if (startupDirectory) {
    process.argv.push('--dir', startupDirectory);
  }

  app.on('second-instance', (_event, argv) => {
    sendDirectoryToRenderer(getDirectoryFromArgs(argv));
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    sendDirectoryToRenderer(getDirectoryFromLink(url));
  });

  await import('./electron.mjs');
}
