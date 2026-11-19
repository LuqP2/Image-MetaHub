import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { exportBoardPng } from '../electron/boardPngExport.mjs';

const root = process.env.IMH_659_SMOKE_ROOT;
if (!root || !path.resolve(root).includes('canvas-smoke-local')) throw new Error('Synthetic smoke root required.');
app.setPath('userData', path.join(root, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
try {
  await fs.mkdir(root, { recursive: true });
  for (const scale of [1, 2, 4]) {
    const filePath = path.join(root, `export-${scale}.png`);
    await exportBoardPng({ BrowserWindow, parent: undefined, dialog: { showSaveDialog: async () => ({ canceled: false, filePath }) }, input: { html: '<div style="width:2200px;height:300px;background:#ff0000"><span style="color:white">Synthetic PNG</span></div>', width: 2200 * scale, height: 320 * scale, scale, name: 'synthetic' } });
    const image = nativeImage.createFromPath(filePath);
    assert.deepEqual(image.getSize(), { width: 2200 * scale, height: 320 * scale });
    const pixel = image.crop({ x: 2100 * scale, y: 280 * scale, width: 1, height: 1 }).toBitmap();
    assert.equal(image.crop({ x: 10, y: 310 * scale, width: 1, height: 1 }).toBitmap()[3], 0, 'Transparent background was lost');
    assert(pixel[2] > 240 && pixel[1] < 10 && pixel[3] > 240, `Scene pixel failed at ${scale}x: ${pixel}`);
  }
  const cancelled = await exportBoardPng({ BrowserWindow, dialog: { showSaveDialog: async () => ({ canceled: true }) }, input: { html: '<div/>', width: 1, height: 1, scale: 1, name: 'cancelled' } });
  assert.equal(cancelled, null);
  console.log('Synthetic PNG smoke passed: 1x/2x/4x, large scene pixels, alpha and cancellation.');
  app.exit(0);
} catch (error) { console.error(error); app.exit(1); }

});
