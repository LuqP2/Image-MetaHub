import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';
const env = { ...process.env, IMH_659_SMOKE_ROOT: path.resolve('build/canvas-smoke-local/issue659-png') };
delete env.ELECTRON_RUN_AS_NODE;
await new Promise((resolve, reject) => {
  const child = spawn(electron, [path.resolve('scripts/issue659PngSmokeMain.mjs')], { env, windowsHide: true, stdio: 'inherit' });
  const timer = setTimeout(() => { child.kill(); reject(new Error('PNG smoke timed out.')); }, 45000);
  child.on('error', reject); child.on('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`PNG smoke failed: ${code}`)); });
});
