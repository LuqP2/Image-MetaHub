import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const MODEL_MEDIA_SCHEME = 'imh-model-media';
const referencePattern = /^imh-model-media:\/\/media\/([a-f0-9]{64}\.(?:jpg|png|webp))$/;

export function resolveModelMediaPath(directory, reference) {
  const match = typeof reference === 'string' && reference.match(referencePattern);
  if (!match) throw new Error('Invalid model media reference.');
  return path.join(directory, match[1]);
}

export async function storeModelMedia(directory, value) {
  if (typeof value === 'string' && referencePattern.test(value)) return value;
  if (typeof value !== 'string' || value.length > 12 * 1024 * 1024) throw new Error('Model image exceeds the storage limit.');
  const match = value.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) throw new Error('Unsupported model image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Invalid model image size.');
  const extension = /jpe?g/i.test(match[1]) ? 'jpg' : match[1].toLowerCase();
  const name = `${crypto.createHash('sha256').update(bytes).digest('hex')}.${extension}`;
  const reference = `${MODEL_MEDIA_SCHEME}://media/${name}`;
  const destination = resolveModelMediaPath(directory, reference);
  await fs.mkdir(directory, { recursive: true });
  try { await fs.access(destination); return reference; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(directory, `${name}.${crypto.randomUUID()}.tmp`);
  try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, destination); }
  finally { await fs.unlink(temporary).catch(() => {}); }
  return reference;
}
