import { spawn } from 'node:child_process';
import electronPath from 'electron';
import path from 'node:path';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
await new Promise((resolve, reject) => {
  const child = spawn(electronPath, [path.resolve('scripts/canvasPromptSidebarSmokeMain.mjs')], { env, windowsHide: true, stdio: 'inherit' });
  const timeout = setTimeout(() => { child.kill(); reject(new Error('Canvas sidebar smoke timed out')); }, 120000);
  child.once('error', error => { clearTimeout(timeout); reject(error); });
  child.once('exit', code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(`Canvas sidebar smoke failed: ${code}`)); });
});
