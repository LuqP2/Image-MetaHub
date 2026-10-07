import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Synthetic acceptance data only. Existing files are never overwritten or read.
const root = path.resolve('.tmp/model-manager-usage');
async function write(relative, bytes) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try { await fs.writeFile(target, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
const model = (title) => {
  const header = Buffer.from(JSON.stringify({ __metadata__: { 'modelspec.title': title, 'modelspec.type': 'checkpoint' } }));
  const length = Buffer.alloc(8); length.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([length, header]);
};
const first = model('Synthetic A'), second = model('Synthetic B');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
await write('models/a/usage-style.safetensors', first);
await write('models/a/usage-alias.safetensors', first);
await write('models/b/usage-style.safetensors', second);
await write('unsupported/usage-vae.safetensors', model('Synthetic VAE'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=', 'base64');
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, bytes, checksum]);
}
for (const [name, modelName, modelHash] of [
  ['confirmed-a', 'renamed-source', hash(first)],
  ['confirmed-b', 'renamed-source', hash(second)],
  ['name-alias', 'usage-alias', ''],
  ['ambiguous', 'usage-style', ''],
  ['short-hash', 'usage-style', hash(first).slice(0, 10)],
  ['conflicting-hash', 'usage-style', 'c'.repeat(64)],
]) {
  const parameters = `synthetic test\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 1, Size: 1x1, Model: ${modelName}${modelHash ? `, Model hash: ${modelHash}` : ''}`;
  const metadata = chunk('tEXt', Buffer.from(`parameters\0${parameters}`));
  await write(`images/${name}.png`, Buffer.concat([png.subarray(0, 33), metadata, png.subarray(33)]));
}
console.log(`Synthetic usage acceptance files: ${root}`);
console.log('After hashing all models: A = 2 main (1 hash + 1 name), B = 1 main (hash); both = 2 ambiguous.');
