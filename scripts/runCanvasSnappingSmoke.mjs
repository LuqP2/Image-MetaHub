import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';
const output = path.resolve('build/canvas-smoke-local/snapping');
await fs.mkdir(output, { recursive: true });
if (!process.argv.includes('--runtime-only')) await build({ configFile: false, root: path.resolve('__tests__/fixtures/canvas-snapping-ui'), publicDir: false, base: './', plugins: [react()], css: { postcss: path.resolve('postcss.config.cjs') }, build: { outDir: path.join(output, 'renderer'), emptyOutDir: true } });
const env = { ...process.env, IMH_SNAPPING_SMOKE_ROOT: output }; delete env.ELECTRON_RUN_AS_NODE;
await new Promise((resolve, reject) => {
  const child = spawn(electron, [path.resolve('scripts/canvasSnappingSmokeMain.mjs')], { env, windowsHide: true, stdio: 'inherit' });
  const timer = setTimeout(() => { child.kill(); reject(new Error('Snapping smoke timed out')); }, 120000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Snapping smoke failed: ${code}`)); });
});
