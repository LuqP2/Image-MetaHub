import fs from 'fs/promises';

const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 10_000;

const boxType = (buffer, offset) => buffer.toString('ascii', offset + 4, offset + 8);

const readBoxSize = (buffer, offset, availableEnd) => {
  if (offset + 8 > availableEnd) return null;
  const size32 = buffer.readUInt32BE(offset);
  if (size32 === 0) return { size: availableEnd - offset, headerSize: 8 };
  if (size32 === 1) {
    if (offset + 16 > availableEnd) return null;
    const size64 = buffer.readBigUInt64BE(offset + 8);
    if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { size: Number(size64), headerSize: 16 };
  }
  return { size: size32, headerSize: 8 };
};

const childBoxes = (buffer, start, end) => {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    const header = readBoxSize(buffer, offset, end);
    if (!header || header.size < header.headerSize || offset + header.size > end) break;
    boxes.push({
      type: boxType(buffer, offset),
      start: offset,
      bodyStart: offset + header.headerSize,
      end: offset + header.size,
    });
    offset += header.size;
  }
  return boxes;
};

const durationFromMvhd = (buffer, box) => {
  const version = buffer[box.bodyStart];
  const timescaleOffset = box.bodyStart + (version === 1 ? 20 : 12);
  const durationOffset = box.bodyStart + (version === 1 ? 24 : 16);
  const durationBytes = version === 1 ? 8 : 4;
  if (durationOffset + durationBytes > box.end || timescaleOffset + 4 > box.end) return null;
  const timescale = buffer.readUInt32BE(timescaleOffset);
  if (timescale === 0) return null;
  const duration = version === 1
    ? Number(buffer.readBigUInt64BE(durationOffset))
    : buffer.readUInt32BE(durationOffset);
  return Number.isFinite(duration) ? duration / timescale : null;
};

const videoDimensionsFromTrak = (buffer, trak) => {
  const children = childBoxes(buffer, trak.bodyStart, trak.end);
  const tkhd = children.find((box) => box.type === 'tkhd');
  const mdia = children.find((box) => box.type === 'mdia');
  if (!tkhd || !mdia || tkhd.end - tkhd.bodyStart < 8) return null;
  const handler = childBoxes(buffer, mdia.bodyStart, mdia.end)
    .find((box) => box.type === 'hdlr');
  if (!handler || handler.bodyStart + 12 > handler.end) return null;
  if (buffer.toString('ascii', handler.bodyStart + 8, handler.bodyStart + 12) !== 'vide') return null;
  const width = buffer.readUInt32BE(tkhd.end - 8) / 65536;
  const height = buffer.readUInt32BE(tkhd.end - 4) / 65536;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width: Math.round(width), height: Math.round(height) };
};

export const parseBasicMp4Moov = (buffer) => {
  const boxes = childBoxes(buffer, 0, buffer.length);
  const mvhd = boxes.find((box) => box.type === 'mvhd');
  const videoDimensions = boxes
    .filter((box) => box.type === 'trak')
    .map((box) => videoDimensionsFromTrak(buffer, box))
    .find(Boolean) ?? null;
  const durationSeconds = mvhd ? durationFromMvhd(buffer, mvhd) : null;
  if (!videoDimensions && durationSeconds === null) return null;
  return {
    width: videoDimensions?.width ?? null,
    height: videoDimensions?.height ?? null,
    duration_seconds: durationSeconds,
  };
};

export const readBasicMp4Metadata = async (filePath) => {
  const handle = await fs.open(filePath, 'r');
  try {
    const stats = await handle.stat();
    let offset = 0;
    let boxCount = 0;
    while (offset + 8 <= stats.size && boxCount < MAX_TOP_LEVEL_BOXES) {
      const headerBuffer = Buffer.alloc(16);
      const { bytesRead } = await handle.read(headerBuffer, 0, 16, offset);
      if (bytesRead < 8 || (headerBuffer.readUInt32BE(0) === 1 && bytesRead < 16)) return null;
      const header = readBoxSize(headerBuffer, 0, stats.size - offset);
      if (!header || header.size < header.headerSize || offset + header.size > stats.size) return null;
      if (boxType(headerBuffer, 0) === 'moov') {
        if (header.size > MAX_MOOV_BYTES) return null;
        const moovBody = Buffer.alloc(header.size - header.headerSize);
        const result = await handle.read(
          moovBody,
          0,
          moovBody.length,
          offset + header.headerSize,
        );
        if (result.bytesRead !== moovBody.length) return null;
        return parseBasicMp4Moov(moovBody);
      }
      offset += header.size;
      boxCount += 1;
    }
    return null;
  } finally {
    await handle.close();
  }
};
