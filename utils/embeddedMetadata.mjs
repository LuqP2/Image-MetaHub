import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = 'IEND';
const PNG_TEXT_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt']);
const EDITED_METADATA_KEYS = new Set([
  'imagemetahub_data',
  'parameters',
  'workflow',
  'prompt',
  'invokeai_metadata',
]);

let exiftoolPromise = null;

async function getExiftool() {
  if (!exiftoolPromise) {
    exiftoolPromise = import('exiftool-vendored').then((mod) => mod.exiftool);
  }
  return exiftoolPromise;
}

export function isSupportedEmbeddedMetadataFile(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp';
}

export function getEmbeddedMetadataFormat(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.png') return 'png';
  if (ext === '.jpg' || ext === '.jpeg') return 'jpeg';
  if (ext === '.webp') return 'webp';
  return null;
}

function assertSupportedRaster(filePath) {
  if (!isSupportedEmbeddedMetadataFile(filePath)) {
    throw new Error('Embedded metadata editing supports PNG, JPEG, and WebP files.');
  }
}

function hashText(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

function normalizeBackupKey(filePath) {
  const normalized = path.resolve(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function getBackupPaths(backupRoot, filePath) {
  const backupId = hashText(normalizeBackupKey(filePath));
  const dir = path.join(backupRoot, backupId);
  return {
    backupId,
    dir,
    originalPath: path.join(dir, 'original'),
    manifestPath: path.join(dir, 'manifest.json'),
  };
}

async function readBackupManifest(backupRoot, filePath) {
  const paths = getBackupPaths(backupRoot, filePath);
  try {
    const raw = await fs.readFile(paths.manifestPath, 'utf8');
    return { paths, manifest: JSON.parse(raw) };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[EmbeddedMetadata] Failed to read backup manifest:', error);
    }
    return { paths, manifest: null };
  }
}

export async function getEmbeddedMetadataBackupStatus({ backupRoot, filePath }) {
  const { paths, manifest } = await readBackupManifest(backupRoot, filePath);
  if (!manifest) {
    return { hasBackup: false };
  }

  try {
    await fs.access(paths.originalPath);
    return {
      hasBackup: true,
      backupId: paths.backupId,
      createdAt: manifest.createdAt,
      originalPath: manifest.originalPath,
      size: manifest.size,
      mtimeMs: manifest.mtimeMs,
      sha256: manifest.sha256,
    };
  } catch {
    return { hasBackup: false };
  }
}

export async function ensureEmbeddedMetadataBackup({ backupRoot, filePath }) {
  const status = await getEmbeddedMetadataBackupStatus({ backupRoot, filePath });
  if (status.hasBackup) {
    return status;
  }

  const paths = getBackupPaths(backupRoot, filePath);
  await fs.mkdir(paths.dir, { recursive: true });

  const stats = await fs.stat(filePath);
  const digest = await sha256File(filePath);
  await fs.copyFile(filePath, paths.originalPath);

  const manifest = {
    backupId: paths.backupId,
    originalPath: path.resolve(filePath),
    fileName: path.basename(filePath),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    sha256: digest,
    createdAt: Date.now(),
  };

  await fs.writeFile(paths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { hasBackup: true, ...manifest };
}

export async function restoreEmbeddedMetadataBackup({ backupRoot, filePath }) {
  const { paths, manifest } = await readBackupManifest(backupRoot, filePath);
  if (!manifest) {
    throw new Error('No metadata backup exists for this file.');
  }

  await fs.copyFile(paths.originalPath, filePath);
  return {
    success: true,
    restoredFrom: paths.originalPath,
    manifest,
  };
}

async function removeExiftoolOriginalSidecar(filePath) {
  try {
    await fs.rm(`${filePath}_original`, { force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

export async function stripEmbeddedMetadata(filePath) {
  assertSupportedRaster(filePath);
  const exiftool = await getExiftool();
  await exiftool.write(filePath, {}, {
    ignoreMinorErrors: true,
    writeArgs: ['-overwrite_original', '-all='],
  });
  await removeExiftoolOriginalSidecar(filePath);
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function createITXtChunk(keyword, text) {
  const keywordBuffer = Buffer.from(keyword, 'latin1');
  const textBuffer = Buffer.from(text ?? '', 'utf8');
  const data = Buffer.concat([
    keywordBuffer,
    Buffer.from([0, 0, 0, 0, 0]),
    textBuffer,
  ]);
  return createPngChunk('iTXt', data);
}

function readPngTextKeyword(buffer, offset, length) {
  const dataStart = offset + 8;
  const dataEnd = dataStart + length;
  const nullIndex = buffer.indexOf(0, dataStart);
  if (nullIndex === -1 || nullIndex >= dataEnd) {
    return null;
  }
  return buffer.subarray(dataStart, nullIndex).toString('latin1').toLowerCase();
}

async function injectPngMetadata(filePath, entries) {
  const source = await fs.readFile(filePath);
  if (source.length < 12 || !source.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('File is not a valid PNG image.');
  }

  const chunks = [source.subarray(0, 8)];
  const metadataChunks = entries.map(([keyword, text]) => createITXtChunk(keyword, text));
  let inserted = false;
  let offset = 8;

  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.subarray(offset + 4, offset + 8).toString('ascii');
    const chunkEnd = offset + 12 + length;

    if (chunkEnd > source.length) {
      throw new Error('PNG chunk table is truncated.');
    }

    const keyword = PNG_TEXT_CHUNKS.has(type) ? readPngTextKeyword(source, offset, length) : null;
    const shouldSkip = keyword ? EDITED_METADATA_KEYS.has(keyword) : false;

    if (type === PNG_IEND && !inserted) {
      chunks.push(...metadataChunks);
      inserted = true;
    }

    if (!shouldSkip) {
      chunks.push(source.subarray(offset, chunkEnd));
    }

    offset = chunkEnd;
    if (type === PNG_IEND) {
      break;
    }
  }

  if (!inserted) {
    throw new Error('PNG IEND chunk was not found.');
  }

  await fs.writeFile(filePath, Buffer.concat(chunks));
}

export async function writeEmbeddedMetadata({ backupRoot, filePath, payload, parameters }) {
  assertSupportedRaster(filePath);
  if (!payload || typeof payload !== 'object') {
    throw new Error('No embedded metadata payload was provided.');
  }

  const format = getEmbeddedMetadataFormat(filePath);
  const payloadText = JSON.stringify(payload);
  const parametersText = typeof parameters === 'string' ? parameters : '';
  const backupStatus = await ensureEmbeddedMetadataBackup({ backupRoot, filePath });

  await stripEmbeddedMetadata(filePath);

  if (format === 'png') {
    await injectPngMetadata(filePath, [
      ['imagemetahub_data', payloadText],
      ['parameters', parametersText],
    ]);
  } else {
    const exiftool = await getExiftool();
    await exiftool.write(filePath, {
      ImageDescription: payloadText,
      UserComment: parametersText,
      Comment: parametersText,
    }, {
      ignoreMinorErrors: true,
      writeArgs: ['-overwrite_original'],
    });
    await removeExiftoolOriginalSidecar(filePath);
  }

  return {
    success: true,
    format,
    backup: backupStatus,
  };
}
