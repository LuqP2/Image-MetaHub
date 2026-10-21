// Exercises the real installer and helper in an isolated, synthetic profile.
// CI uses verified local assets; --public exercises the published download URLs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createExrRuntime } from '../electron/exrRuntime.mjs';

const assets = path.resolve(process.argv[2]);
const fixture = path.resolve(process.argv[3]);
const platform = `${process.platform}-${process.arch}`;
const publicDownload = process.argv.includes('--public');
let offline = false;
const policy = JSON.parse(await fs.readFile(path.join(assets, `exr-policy-${platform}.json`), 'utf8'));
const base = path.join(process.cwd(), '.tmp');
await fs.mkdir(base, { recursive: true });
const profile = await fs.mkdtemp(path.join(base, 'exr-install-smoke-á #1-'));
const sourceBytes = await fs.readFile(fixture);
const synthetic = path.join(profile, 'synthetic.exr');
await fs.writeFile(synthetic, sourceBytes);
const runtime = createExrRuntime({
  userDataPath: profile,
  cacheRoot: async () => profile,
  isPathAllowed: value => value.startsWith(profile + path.sep),
  packages: { [platform]: policy },
  fetchImpl: async (url, options) => {
    if (offline) throw new Error('Network disabled after installation');
    return publicDownload ? fetch(url, options) : new Response(await fs.readFile(path.join(assets, path.basename(new URL(url).pathname))));
  },
});
try {
  if ((await runtime.status()).installed) throw new Error('Smoke profile must start empty');
  await runtime.install();
  offline = true;
  const status = await runtime.status();
  if (!status.installed || !status.enabled) throw new Error('Installation did not activate the component');
  const asset = await runtime.inspect(synthetic);
  if (!asset.parts.length) throw new Error('Native EXR inspection failed');
  const preview = await runtime.preview({ requestId: 'smoke', filePath: synthetic });
  const previewPath = await runtime.resolvePreview(preview.url);
  if ((await fs.stat(previewPath)).size <= 0) throw new Error('Native preview was not written');
  const saved = await runtime.settings();
  await runtime.saveSettings({ ...saved, enabled: false });
  let rejected = false;
  try { await runtime.preview({ requestId: 'disabled', filePath: synthetic }); } catch { rejected = true; }
  if (!rejected) throw new Error('Disabled EXR runtime accepted work');
  await runtime.saveSettings({ ...saved, enabled: true });
  await runtime.preview({ requestId: 'offline', filePath: synthetic });
  await runtime.remove();
  if ((await runtime.status()).installed) throw new Error('EXR component was not removed');
  if (!(await fs.readFile(synthetic)).equals(sourceBytes)) throw new Error('Original EXR was changed');
  console.log(JSON.stringify({ ok: true, platform, installedVersion: status.version, previewWidth: preview.width, previewHeight: preview.height, originalPreserved: true }));
} finally {
  await runtime.dispose();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
