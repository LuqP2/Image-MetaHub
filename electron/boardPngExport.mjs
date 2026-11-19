import fs from 'node:fs/promises';

/** Rasterize self-contained board HTML through SVG in a sandboxed Chromium canvas. */
export async function exportBoardPng({ BrowserWindow, dialog, parent, input }) {
  const { html, width, height, scale, name } = input ?? {};
  if (typeof html !== 'string' || html.length > 48 * 1024 * 1024 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 64000000 || ![1, 2, 4].includes(scale)) throw new Error('Invalid PNG export dimensions or content.');
  const filename = `${Array.from(String(name ?? 'board'), character => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('')}.png`;
  const destination = await dialog.showSaveDialog(parent, { title: 'Export PNG', defaultPath: filename, filters: [{ name: 'PNG image', extensions: ['png'] }] });
  if (destination.canceled || !destination.filePath) return null;
  const surface = new BrowserWindow({ show: false, width: Math.min(512, width), height: Math.min(512, height), useContentSize: true, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
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
    stage = 'Rasterizing PNG scene';
    const png = await bounded(surface.webContents.executeJavaScript(`(async () => {
      const scene = document.getElementById('scene');
      const markup = new XMLSerializer().serializeToString(scene);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width / scale} ${height / scale}"><foreignObject x="0" y="0" width="${width / scale}" height="${height / scale}">' + markup + '</foreignObject></svg>';
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await image.decode();
      const canvas = document.getElementById('output');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('PNG canvas is unavailable.');
      context.drawImage(image, 0, 0, ${width}, ${height});
      return canvas.toDataURL('image/png');
    })()`));
    if (!png.startsWith('data:image/png;base64,')) throw new Error('PNG encoding failed.');
    stage = 'Saving PNG';
    await fs.writeFile(destination.filePath, Buffer.from(png.slice('data:image/png;base64,'.length), 'base64'));
    return { exported: true };
  } catch (error) { throw new Error(`${stage}: ${error.message}`, { cause: error }); }
  finally { if (!surface.isDestroyed()) surface.destroy(); }
}
