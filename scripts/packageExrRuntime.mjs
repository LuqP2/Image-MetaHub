import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { EXR_RUNTIME_VERSION, EXR_PROTOCOL_VERSION } from '../electron/exrRuntimePolicy.generated.mjs';

const args = process.argv.slice(2);
const option = key => args[args.indexOf(key) + 1];
const platform = option('--platform');
if (!['win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64'].includes(platform)) throw new Error('Pass --platform <supported target>');
const input = path.resolve(option('--input'));
const out = path.resolve(option('--out'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(out, { recursive: true });
const executable = platform.startsWith('win32') ? 'imh-exr.exe' : 'imh-exr';
await fs.access(path.join(input, executable));
const licenses = args.includes('--licenses') ? path.resolve(option('--licenses')) : null;
if (licenses) {
  for (const entry of await fs.readdir(licenses, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = path.join(licenses, entry.name, 'copyright');
    try { await fs.copyFile(source, path.join(input, `LICENSE-${entry.name}.txt`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
const files = [];
for (const entry of await fs.readdir(input, { withFileTypes: true })) {
  if (!entry.isFile() || !/^[a-zA-Z0-9_.-]+$/.test(entry.name)) throw new Error(`Unsupported runtime package entry: ${entry.name}`);
  const bytes = await fs.readFile(path.join(input, entry.name));
  const compressed = gzipSync(bytes, { level: 9 });
  const asset = `exr-runtime-${EXR_RUNTIME_VERSION}-${platform}-${entry.name}.gz`;
  await fs.writeFile(path.join(out, asset), compressed);
  files.push({ name: entry.name, size: bytes.length, sha256: hash(bytes), downloadSize: compressed.length, downloadSha256: hash(compressed), url: `https://github.com/LuqP2/Image-MetaHub/releases/download/exr-runtime-v${EXR_RUNTIME_VERSION}/${asset}` });
}
const policy = { version: EXR_RUNTIME_VERSION, protocol: EXR_PROTOCOL_VERSION, platform, executable, files };
await fs.writeFile(path.join(out, `exr-policy-${platform}.json`), JSON.stringify(policy, null, 2));
console.log(JSON.stringify({ platform, bytes: files.reduce((s, f) => s + f.downloadSize, 0), installedBytes: files.reduce((s, f) => s + f.size, 0) }));
