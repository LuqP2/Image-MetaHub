import fs from 'node:fs/promises';

/** Render inert, self-contained board HTML in an isolated Chromium surface, then compose bounded tiles. */
export async function exportBoardPng({ BrowserWindow, dialog, parent, input }) {
  const { html, width, height, scale, name } = input ?? {};
  if (typeof html !== 'string' || html.length > 48 * 1024 * 1024 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 64000000 || ![1, 2, 4].includes(scale)) throw new Error('Invalid PNG export dimensions or content.');
  const filename = `${Array.from(String(name ?? 'board'), character => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('')}.png`;
  const destination = await dialog.showSaveDialog(parent, { title: 'Export PNG', defaultPath: filename, filters: [{ name: 'PNG image', extensions: ['png'] }] });
  if (destination.canceled || !destination.filePath) return null;
  const surface = new BrowserWindow({ show: false, width: Math.min(2048, width), height: Math.min(2048, height), useContentSize: true, transparent: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    surface.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    surface.webContents.on('will-navigate', event => event.preventDefault());
    surface.webContents.on('will-attach-webview', event => event.preventDefault());
    await surface.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}#scene{transform-origin:0 0}#output{display:none}</style></head><body><div id="scene">${html}</div><canvas id="output" width="${width}" height="${height}"></canvas></body></html>`)}`);
    surface.webContents.setZoomFactor(1);
    await surface.webContents.executeJavaScript(`Promise.all([document.fonts.ready,...Array.from(document.images,image=>image.decode())]).then(()=>true)`);
    for (let y = 0; y < height; y += 2048) for (let x = 0; x < width; x += 2048) {
      const tileWidth = Math.min(2048, width - x), tileHeight = Math.min(2048, height - y);
      await surface.webContents.executeJavaScript(`document.getElementById('scene').style.transform='translate(${-x}px,${-y}px) scale(${scale})';new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
      const captured = await surface.webContents.capturePage({ x: 0, y: 0, width: tileWidth, height: tileHeight });
      const data = captured.resize({ width: tileWidth, height: tileHeight }).toDataURL();
      await surface.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{document.getElementById('output').getContext('2d').drawImage(image,${x},${y},${tileWidth},${tileHeight});resolve(true)};image.onerror=()=>reject(new Error('Could not compose PNG tile'));image.src=${JSON.stringify(data)}})`);
    }
    const png = await surface.webContents.executeJavaScript(`document.getElementById('output').toDataURL('image/png')`);
    if (!png.startsWith('data:image/png;base64,')) throw new Error('PNG encoding failed.');
    await fs.writeFile(destination.filePath, Buffer.from(png.slice('data:image/png;base64,'.length), 'base64'));
    return { exported: true };
  } finally { if (!surface.isDestroyed()) surface.destroy(); }
}
