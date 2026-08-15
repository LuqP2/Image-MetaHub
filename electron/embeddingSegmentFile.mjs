import fs from 'fs/promises';

/**
 * Writes new segment bytes exactly after the manifest-committed prefix.
 * Trailing bytes belong to a flush whose manifest never committed and must be
 * discarded before the row index can assign those positions to new images.
 */
export const appendEmbeddingSegmentAtOffset = async (
  filePath,
  data,
  expectedOffset,
) => {
  if (!Number.isSafeInteger(expectedOffset) || expectedOffset < 0) {
    throw new Error('Invalid embedding segment offset');
  }

  const payload = Buffer.from(data);
  let handle;
  try {
    handle = await fs.open(filePath, 'r+');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    if (expectedOffset !== 0) {
      throw new Error(`Embedding segment is missing at committed offset ${expectedOffset}`);
    }
    handle = await fs.open(filePath, 'w+');
  }

  try {
    const stats = await handle.stat();
    if (stats.size < expectedOffset) {
      throw new Error(
        `Embedding segment is shorter than its committed offset (${stats.size} < ${expectedOffset})`,
      );
    }
    if (stats.size > expectedOffset) {
      await handle.truncate(expectedOffset);
    }

    let written = 0;
    while (written < payload.length) {
      const result = await handle.write(
        payload,
        written,
        payload.length - written,
        expectedOffset + written,
      );
      if (result.bytesWritten <= 0) {
        throw new Error('Embedding segment write made no progress');
      }
      written += result.bytesWritten;
    }

    return expectedOffset + payload.length;
  } finally {
    await handle.close();
  }
};
