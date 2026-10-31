import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import electronPath from 'electron';

const output = path.resolve('build/canvas-smoke-local/canvas-v1-ui');
await fs.mkdir(path.join(output, 'profile'), { recursive: true });
if (!process.argv.includes('--runtime-only')) await build({ configFile: false, root: path.resolve('__tests__/fixtures/canvas-v1-ui'), publicDir: false, base: './', plugins: [react()], css: { postcss: path.resolve('postcss.config.cjs') }, worker: { format: 'es' }, build: { outDir: path.join(output, 'renderer'), emptyOutDir: true } });
const env = { ...process.env, IMH_CANVAS_UI_SMOKE_ROOT: output }; delete env.ELECTRON_RUN_AS_NODE;
await new Promise((resolve, reject) => {
  const child = spawn(electronPath, [path.resolve('scripts/canvasV1UiSmokeMain.mjs')], { env, windowsHide: true, stdio: 'inherit' });
  const timeout = setTimeout(() => { child.kill(); reject(new Error('Canvas UI smoke timed out')); }, 90000);
  child.once('error', error => { clearTimeout(timeout); reject(error); });
  child.once('exit', code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(`Canvas UI smoke failed: ${code}`)); });
});
process.stdout.write(`Canvas UI artifacts: ${output}\n`);
