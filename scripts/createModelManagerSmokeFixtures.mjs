import fs from 'node:fs/promises';
import path from 'node:path';

// Deliberately synthetic files. Run manually; never reads a user's model or image.
const directory = path.resolve('.tmp/model-manager-smoke');
await fs.mkdir(path.join(directory, 'models'), { recursive: true });
await fs.mkdir(path.join(directory, 'images'), { recursive: true });
const header = Buffer.from(JSON.stringify({ __metadata__: { 'modelspec.title': 'Synthetic smoke LoRA', 'modelspec.type': 'lora', 'modelspec.base_model': 'SDXL', 'modelspec.trigger_phrase': 'synthetic smoke' } }));
const prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(header.length));
const file = Buffer.concat([prefix, header]);
for (const name of ['synthetic-one.safetensors', 'synthetic-copy.safetensors']) {
  try { await fs.writeFile(path.join(directory, 'models', name), file, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=', 'base64');
try { await fs.writeFile(path.join(directory, 'images', 'synthetic-example.png'), png, { flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
console.log(`Synthetic model-manager smoke files: ${directory}`);
