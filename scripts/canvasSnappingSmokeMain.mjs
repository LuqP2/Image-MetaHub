import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
const output = process.env.IMH_SNAPPING_SMOKE_ROOT;
if (!output || !path.resolve(output).includes('canvas-smoke-local')) throw new Error('Isolated smoke directory required');
app.setPath('userData', path.join(output, `profile-${process.pid}`));
app.disableHardwareAcceleration();
process.stdout.write('Snapping Electron starting\n');
app.whenReady().then(async () => {
process.stdout.write('Snapping Electron ready\n');
const window = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { backgroundThrottling: false } });
const pause = () => new Promise(resolve => setTimeout(resolve, 80));
const evaluate = code => window.webContents.executeJavaScript(code);
const check = (condition, message) => { if (!condition) throw new Error(message); };
let uninitializedWarnings = 0;
try {
  window.webContents.on('console-message', event => { if (event.message.includes('error#015')) uninitializedWarnings++; if (event.level === 'error') process.stderr.write(event.message + '\n'); });
  await window.loadFile(path.join(output, 'renderer/index.html'));
  process.stdout.write('Snapping renderer loaded\n');
  await pause();
  process.stdout.write('Enabling Flow diagnostics\n');
  await evaluate('window.beginFlowDiagnostics()');
  process.stdout.write('Flow diagnostics enabled\n');
  window.webContents.debugger.attach('1.3');
  const mouse = async (type, x, y, modifiers = 0) => {
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1, modifiers });
    await pause();
  };
  const shift = async down => {
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: down ? 8 : 0 });
    await pause();
  };
  process.stdout.write('Starting drag checks\n');
  const from = await evaluate(`(() => { const r = document.querySelector('.react-flow__node[data-id="moving"]').getBoundingClientRect(); return {x:r.x+20,y:r.y+20}; })()`);
  await mouse('mousePressed', from.x, from.y);
  await mouse('mouseMoved', from.x + 2, from.y);
  await mouse('mouseMoved', from.x + 199, from.y);
  const snapped = await evaluate('window.snappingSmoke.position()');
  check(snapped.x === 300, `Expected object snap x=300, got ${snapped.x}`);
  check((await evaluate('window.snappingSmoke.guides()')).includes('x'), 'Missing X guide');
  const rendered = await evaluate(`(() => { const r = document.querySelector('.react-flow__node[data-id="moving"]').getBoundingClientRect(); return { x: r.x, y: r.y, guides: document.querySelector('[aria-label="Smart Guides"]')?.outerHTML, guideRect: document.querySelector('[aria-label="Smart Guides"]')?.getBoundingClientRect().toJSON() }; })()`);

  check(Math.abs(rendered.x - 300) < 1, `Rendered node did not follow snapped document: ${rendered.x}`);
  window.webContents.invalidate();
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  await new Promise(resolve => setTimeout(resolve, 300));
  await fs.writeFile(path.join(output, 'smart-guides.png'), (await window.webContents.capturePage()).toPNG());
  await shift(true);
  const free = await evaluate('window.snappingSmoke.position()');
  check(free.x === 297, `Shift should restore free x=297, got ${free.x}`);
  check((await evaluate('window.snappingSmoke.guides()')).length === 0, 'Guides remained under Shift');
  await shift(false);
  check((await evaluate('window.snappingSmoke.position()')).x === 300, 'Shift release did not re-snap');
  await mouse('mouseMoved', from.x + 210, from.y);
  check((await evaluate('window.snappingSmoke.position()')).x === 308, 'Drag accumulated a correction');
  await mouse('mouseMoved', from.x + 199, from.y);
  await mouse('mouseReleased', from.x + 199, from.y);
  check(await evaluate('window.snappingSmoke.history()') === 1, 'Drag created multiple undo entries');
  check((await evaluate('window.snappingSmoke.guides()')).length === 0, 'Guides remained after release');
  await evaluate('window.snappingSmoke.undo()');
  check((await evaluate('window.snappingSmoke.position()')).x === 100, 'Undo did not restore initial position');
  await evaluate('window.snappingSmoke.redo()');
  check((await evaluate('window.snappingSmoke.position()')).x === 300, 'Redo lost snapping');
  process.stdout.write('Starting selection checks\n');
  for (const mode of ['multi', 'framed', 'mixed']) {
    process.stdout.write(`Selection check ${mode}\n`);
    await evaluate(`window.snappingSmoke.reset('${mode}')`); await pause();
    const start = await evaluate(`(() => { const r = document.querySelector('.react-flow__node[data-id="moving"]').getBoundingClientRect(); return {x:r.x+20,y:r.y+20}; })()`);
    await mouse('mousePressed', start.x, start.y);
    await mouse('mouseMoved', start.x + 2, start.y);
    await mouse('mouseMoved', start.x + 199, start.y);
    const positions = await evaluate('window.snappingSmoke.positions()');
    const a = positions.find(item => item.id === 'moving'), b = positions.find(item => item.id === 'second');
    check(a.x === (mode === 'mixed' ? 297 : 300), `${mode} unexpected position ${a.x}`);
    check(a.x === b.x && b.y - a.y === 350, `${mode} changed relative spacing`);
    if (mode === 'mixed') check((await evaluate('window.snappingSmoke.guides()')).length === 0, 'Mixed selection snapped');
    await mouse('mouseReleased', start.x + 199, start.y);
  }
  process.stdout.write('Starting dense drag\n');
  await evaluate(`window.snappingSmoke.reset('multi')`); await pause();
  await mouse('mousePressed', 120, 120);
  await mouse('mouseMoved', 122, 120);
  const denseStart = Date.now();
  await evaluate(`(async () => {
    for (let step = 0; step < 60; step++) {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 130 + step * 2, clientY: 120, buttons: 1, bubbles: true, view: window }));
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  })()`);
  await mouse('mouseReleased', 248, 120);
  process.stdout.write(`Dense drag 60 updates: ${Date.now() - denseStart} ms\n`);
  uninitializedWarnings = (await evaluate('window.snappingSmoke.diagnostics()')).uninitialized;
  process.stdout.write(`React Flow #015 warnings: ${uninitializedWarnings}\n`);
  check(uninitializedWarnings === 0, `React Flow emitted ${uninitializedWarnings} uninitialized-node errors`);
  const result = { uninitializedWarnings, denseDrag: true, multiSelection: true, framedCards: true, mixedSelectionFree: true, objectSnap: true, stationaryShift: true, freePositionIndependent: true, singleUndo: true, undoRedo: true };
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  console.error(error); process.exitCode = 1;
  const capture = await Promise.race([window.webContents.capturePage(), new Promise(resolve => setTimeout(() => resolve(null), 3000))]);
  if (capture) await fs.writeFile(path.join(output, 'failure.png'), capture.toPNG());
} finally { window.destroy(); app.exit(process.exitCode ?? 0); }

}).catch(error => { console.error(error); app.exit(1); });
