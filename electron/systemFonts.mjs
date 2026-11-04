import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
let pending;
// Static command only: renderer input never reaches PowerShell. No font files are read by the app.
export function listSystemFonts() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return pending ??= run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Drawing; $collection = [System.Drawing.Text.InstalledFontCollection]::new(); try { ConvertTo-Json -Compress -InputObject @($collection.Families | ForEach-Object { $_.Name } | Sort-Object -Unique) } finally { $collection.Dispose() }",
  ], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' }).then(({ stdout }) => {
    const names = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) throw new Error('Invalid system font list.');
    return names.filter(name => name.trim() && name.length <= 200 && !Array.from(name).some(character => character.charCodeAt(0) < 32));
  }).catch(error => { pending = undefined; throw error; });
}
