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

function normalizeCliArgs(args) {
  return Array.from(args || []).slice(app.isPackaged ? 1 : 2);
}

function getTargetFromLink(value) {
  if (!isDeepLink(value)) return null;
  try {
    const url = new URL(value);
    const rawFile = url.searchParams.get('file');
    if (rawFile) {
      return { type: 'file', path: path.resolve(rawFile) };
    }
    const rawPath = url.searchParams.get('path') || url.searchParams.get('dir') || url.searchParams.get('directory');
    return rawPath ? { type: 'directory', path: path.resolve(rawPath) } : null;
  } catch (error) {
    console.warn('[ImageMetaHub protocol] Invalid URL:', error);
    return null;
  }
}

function getDirectoryFromCliArgs(args) {
  const argv = normalizeCliArgs(args);
  const dirFlagIndex = argv.indexOf('--dir');

  if (dirFlagIndex !== -1 && argv[dirFlagIndex + 1]) {
    return path.resolve(argv[dirFlagIndex + 1]);
  }

  const directPath = argv.find((arg) => {
    if (typeof arg !== 'string' || !arg.trim() || arg.startsWith('--')) return false;
    if (isDeepLink(arg)) return false;
    if (arg === process.execPath) return false;
    if (arg.endsWith('.exe') || arg.endsWith('.mjs') || arg.endsWith('.js')) return false;
    return true;
  });

  return directPath ? path.resolve(directPath) : null;
}

function getDirectoryFromArgs(args) {
  const linkTarget = getTargetFromLink(findDeepLink(args));
  if (linkTarget?.type === 'directory') {
    return linkTarget.path;
  }
  return getDirectoryFromCliArgs(args);
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

function sendFileToRenderer(filePath, attempt = 0) {
  if (!filePath) return;
  const target = focusMainWindow();
  if (!target || target.webContents.isLoading()) {
    if (attempt < 120) {
      setTimeout(() => sendFileToRenderer(filePath, attempt + 1), 250);
    }
    return;
  }
  target.webContents.send('open-file-from-deep-link', filePath);
}

function dispatchTarget(target) {
  if (target?.type === 'file') {
    sendFileToRenderer(target.path);
  } else if (target?.type === 'directory') {
    sendDirectoryToRenderer(target.path);
  }
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

  const startupTarget = getTargetFromLink(findDeepLink(process.argv));
  const startupDirectory = startupTarget?.type === 'file' ? null : getDirectoryFromArgs(process.argv);
  if (startupDirectory) {
    process.argv.push('--dir', startupDirectory);
  }

  app.on('second-instance', (_event, argv) => {
    const target = getTargetFromLink(findDeepLink(argv));
    if (target) {
      dispatchTarget(target);
      return;
    }
    focusMainWindow();
    sendDirectoryToRenderer(getDirectoryFromArgs(argv));
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    dispatchTarget(getTargetFromLink(url));
  });

  await import('./electron.mjs');
  if (startupTarget?.type === 'file') {
    sendFileToRenderer(startupTarget.path);
  }
}
