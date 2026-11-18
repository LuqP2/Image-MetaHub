import fs from 'node:fs/promises';

/** Render inert, self-contained board HTML in an isolated Chromium surface, then compose bounded tiles. */
export async function exportBoardPng({ BrowserWindow, dialog, parent, input }) {
  const { html, width, height, scale, name } = input ?? {};
  if (typeof html !== 'string' || html.length > 48 * 1024 * 1024 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 64000000 || ![1, 2, 4].includes(scale)) throw new Error('Invalid PNG export dimensions or content.');
  const filename = `${Array.from(String(name ?? 'board'), character => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('')}.png`;
  const destination = await dialog.showSaveDialog(parent, { title: 'Export PNG', defaultPath: filename, filters: [{ name: 'PNG image', extensions: ['png'] }] });
  if (destination.canceled || !destination.filePath) return null;
  const surface = new BrowserWindow({ show: false, width: Math.min(512, width), height: Math.min(512, height), useContentSize: true, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const [contentWidth, contentHeight] = surface.getContentSize();
  const tileSpanX = Math.max(1, Math.min(512, contentWidth));
  const tileSpanY = Math.max(1, Math.min(512, contentHeight));
  let stage = 'Preparing export';
  const bounded = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out')), 15000); })]); }
    finally { clearTimeout(timer); }
  };
  try {
    surface.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    surface.webContents.on('will-navigate', event => event.preventDefault());
    surface.webContents.on('will-attach-webview', event => event.preventDefault());
    await bounded(surface.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}#scene{transform-origin:0 0}#output{display:none}</style></head><body><div id="scene"></div><canvas id="output" width="${width}" height="${height}"></canvas></body></html>`)}`));
    surface.webContents.setZoomFactor(scale);
    stage = 'Loading export images and fonts';
    await bounded(surface.webContents.executeJavaScript(`document.getElementById('scene').innerHTML=${JSON.stringify(html)};Promise.all([document.fonts.ready,...Array.from(document.images,image=>image.decode())]).then(()=>true)`));
    surface.webContents.startPainting();

    for (let y = 0; y < height; y += tileSpanY) for (let x = 0; x < width; x += tileSpanX) {
      const tileWidth = Math.min(tileSpanX, width - x), tileHeight = Math.min(tileSpanY, height - y);
      stage = `Rendering PNG tile (${x}, ${y})`;
      await bounded(surface.webContents.executeJavaScript(`document.getElementById('scene').style.transform='translate(${-x / scale}px,${-y / scale}px)';document.getElementById('scene').getBoundingClientRect().width`));
      await bounded(new Promise(resolve => {
        surface.webContents.once('paint', () => resolve());
        surface.webContents.invalidate();
      }));
      const captured = await bounded(surface.webContents.capturePage({ x: 0, y: 0, width: tileWidth, height: tileHeight }, { stayHidden: true, stayAwake: true }));
      if (captured.isEmpty()) throw new Error('The export surface returned an empty image.');
      const data = captured.resize({ width: tileWidth, height: tileHeight }).toDataURL();
      await bounded(surface.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{document.getElementById('output').getContext('2d').drawImage(image,${x},${y},${tileWidth},${tileHeight});resolve(true)};image.onerror=()=>reject(new Error('Could not compose PNG tile'));image.src=${JSON.stringify(data)}})`));
    }
    const png = await bounded(surface.webContents.executeJavaScript(`document.getElementById('output').toDataURL('image/png')`));
    if (!png.startsWith('data:image/png;base64,')) throw new Error('PNG encoding failed.');
    stage = 'Saving PNG';
    await fs.writeFile(destination.filePath, Buffer.from(png.slice('data:image/png;base64,'.length), 'base64'));
    return { exported: true };
  } catch (error) { throw new Error(`${stage}: ${error.message}`, { cause: error }); }
  finally { if (!surface.isDestroyed()) surface.destroy(); }
}
