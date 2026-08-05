import {
  type EmbeddingManifest,
  type EmbeddingRowEntry,
  type QuantizedVector,
  ROW_FLAG_TOMBSTONE,
  ROW_INDEX_CHUNK_SIZE,
  SEGMENT_ROWS,
  buildContentKey,
  centroidFrom,
  createEmptyManifest,
  encodeRow,
  isManifestCompatible,
  manifestFileName,
  rowChunkFileName,
  rowStrideBytes,
  segmentFileName,
} from './embeddingFormat';

/**
 * Owns the on-disk vector index for one library (cacheId).
 *
 * The manifest is the source of truth for how much of each segment is real:
 * writes go segment bytes first, then row chunks, then the manifest, so an
 * interrupted flush leaves trailing bytes that the next load ignores rather
 * than a row index that points at vectors which were never written.
 */

const getElectronAPI = () => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api) {
    throw new Error('Embedding storage requires the Electron bridge');
  }
  return api;
};

export const toSafeCacheId = (cacheId: string): string =>
  cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');

export interface PendingAppend {
  imageId: string;
  contentKey: string;
  bytes: Uint8Array;
}

export interface EmbeddingIndexStats {
  totalRows: number;
  liveRows: number;
  tombstoneCount: number;
  modelId: string;
  dim: number;
}

export class EmbeddingIndex {
  private readonly safeCacheId: string;

  private manifest: EmbeddingManifest;

  /** Physical rows, index === row number. Length always equals manifest.totalRows. */
  private rows: EmbeddingRowEntry[] = [];

  private rowByImageId = new Map<string, number>();

  private pending: PendingAppend[] = [];

  private dirtyRowChunks = new Set<number>();

  private manifestDirty = false;

  /**
   * Running sum of every appended vector, kept in float64 so a 400k-row sum does
   * not accumulate rounding error. Mirrored into the manifest on flush.
   */
  private centroidSum: Float64Array;

  private centroidCount = 0;

  private constructor(safeCacheId: string, manifest: EmbeddingManifest) {
    this.safeCacheId = safeCacheId;
    this.manifest = manifest;
    this.centroidSum = new Float64Array(manifest.dim);
    if (manifest.centroidSum?.length === manifest.dim) {
      this.centroidSum.set(manifest.centroidSum);
      this.centroidCount = manifest.centroidCount ?? 0;
    }
  }

  static async open(cacheId: string, modelId: string, modelRevision: string, dim: number): Promise<EmbeddingIndex> {
    const safeCacheId = toSafeCacheId(cacheId);
    const api = getElectronAPI();
    const manifestResult = await api.readEmbeddingFile({ fileName: manifestFileName(safeCacheId) });
    const stored = manifestResult.success ? (manifestResult.data as EmbeddingManifest | null) : null;

    if (!isManifestCompatible(stored, modelId, dim)) {
      // A different model, dim or format cannot be reinterpreted. Embeddings are
      // derived data, so dropping and rebuilding is always the safe recovery.
      if (stored) {
        await api.deleteEmbeddingIndex({ cacheId });
      }
      return new EmbeddingIndex(safeCacheId, createEmptyManifest(modelId, modelRevision, dim));
    }

    const index = new EmbeddingIndex(safeCacheId, stored);
    await index.loadRowIndex();
    return index;
  }

  private async loadRowIndex(): Promise<void> {
    const api = getElectronAPI();
    const rows: EmbeddingRowEntry[] = [];

    for (let chunk = 0; chunk < this.manifest.rowChunkCount; chunk += 1) {
      const result = await api.readEmbeddingFile({ fileName: rowChunkFileName(this.safeCacheId, chunk) });
      const entries = result.success && Array.isArray(result.data) ? (result.data as EmbeddingRowEntry[]) : [];
      for (const entry of entries) {
        rows.push(entry);
      }
    }

    // A chunk may hold entries from a flush whose manifest write never landed.
    this.rows = rows.slice(0, this.manifest.totalRows);
    this.rebuildLookup();
  }

  private rebuildLookup(): void {
    this.rowByImageId.clear();
    for (let row = 0; row < this.rows.length; row += 1) {
      const entry = this.rows[row];
      if ((entry[2] & ROW_FLAG_TOMBSTONE) === 0) {
        this.rowByImageId.set(entry[0], row);
      }
    }
  }

  get stats(): EmbeddingIndexStats {
    return {
      totalRows: this.manifest.totalRows,
      liveRows: this.manifest.liveRows,
      tombstoneCount: this.manifest.tombstoneCount,
      modelId: this.manifest.modelId,
      dim: this.manifest.dim,
    };
  }

  get dim(): number {
    return this.manifest.dim;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  hasVector(imageId: string): boolean {
    return this.rowByImageId.has(imageId);
  }

  /** Returns the stored content key, or null when the image has no live row. */
  contentKeyFor(imageId: string): string | null {
    const row = this.rowByImageId.get(imageId);
    return row === undefined ? null : this.rows[row][1];
  }

  /** Live image ids paired with the content they were embedded from. */
  liveEntries(): Map<string, string> {
    const entries = new Map<string, string>();
    for (const [imageId, row] of this.rowByImageId) {
      entries.set(imageId, this.rows[row][1]);
    }
    return entries;
  }

  /**
   * Buffers a vector for the next flush. Re-embedding an image tombstones its
   * previous row: segments are append-only, so the old vector stays on disk
   * until compaction but stops being reachable immediately.
   */
  append(imageId: string, contentKey: string, quantized: QuantizedVector): void {
    if (this.rowByImageId.has(imageId)) {
      this.tombstone([imageId]);
    }
    this.pending.push({
      imageId,
      contentKey,
      bytes: encodeRow(this.manifest.dim, quantized),
    });
    this.accumulateCentroid(quantized);
  }

  /**
   * Folds a vector into the running centroid. Deliberately approximate: rows
   * that are later tombstoned are never subtracted back out, and a failed flush
   * leaves the sum slightly ahead of what is durable. Both are harmless — the
   * centroid only has to describe the *shape* of the library well enough to
   * remove the modality gap, and a few stale vectors out of thousands do not
   * move a 512-dimensional mean measurably.
   */
  private accumulateCentroid(quantized: QuantizedVector): void {
    const { dim } = this.manifest;
    for (let i = 0; i < dim; i += 1) {
      this.centroidSum[i] += quantized.codes[i] * quantized.scale;
    }
    this.centroidCount += 1;
    this.manifestDirty = true;
  }

  /**
   * Mean image vector, or null while the index is too small to have one. Text
   * queries are scored against centered vectors; Find Similar is not, since
   * image↔image comparisons have no modality gap to correct.
   */
  centroid(): Float32Array | null {
    return centroidFrom(Array.from(this.centroidSum), this.centroidCount, this.manifest.dim);
  }

  /**
   * Monotonic counter that changes whenever the centroid moves, so a consumer
   * can tell whether the copy it holds is still current.
   */
  get centroidVersion(): number {
    return this.centroidCount;
  }

  tombstone(imageIds: string[]): number {
    let removed = 0;
    for (const imageId of imageIds) {
      const row = this.rowByImageId.get(imageId);
      if (row === undefined) continue;
      this.rows[row] = [this.rows[row][0], this.rows[row][1], this.rows[row][2] | ROW_FLAG_TOMBSTONE];
      this.rowByImageId.delete(imageId);
      this.dirtyRowChunks.add(Math.floor(row / ROW_INDEX_CHUNK_SIZE));
      this.manifest.tombstoneCount += 1;
      this.manifest.liveRows -= 1;
      this.manifestDirty = true;
      removed += 1;
    }
    return removed;
  }

  /**
   * Follows an in-app rename. The vector itself is unchanged, so only the row's
   * image id moves; without this every rename would orphan an embedding.
   */
  rename(oldImageId: string, newImageId: string): boolean {
    const row = this.rowByImageId.get(oldImageId);
    if (row === undefined) return false;
    this.rows[row] = [newImageId, this.rows[row][1], this.rows[row][2]];
    this.rowByImageId.delete(oldImageId);
    this.rowByImageId.set(newImageId, row);
    this.dirtyRowChunks.add(Math.floor(row / ROW_INDEX_CHUNK_SIZE));
    this.manifestDirty = true;
    return true;
  }

  /**
   * Commits buffered vectors. Returns the rows that became durable so callers
   * can forward them to a running search worker.
   */
  async flush(): Promise<Array<{ imageId: string; row: number }>> {
    if (this.pending.length === 0 && this.dirtyRowChunks.size === 0 && !this.manifestDirty) {
      return [];
    }

    const api = getElectronAPI();
    const stride = rowStrideBytes(this.manifest.dim);
    const committed: Array<{ imageId: string; row: number }> = [];
    const firstRow = this.manifest.totalRows;

    // Group consecutive pending rows by the segment they land in, so a flush
    // costs one append per segment rather than one per vector.
    let cursor = 0;
    while (cursor < this.pending.length) {
      const physicalRow = firstRow + cursor;
      const segmentIndex = Math.floor(physicalRow / SEGMENT_ROWS);
      const segmentCapacityLeft = SEGMENT_ROWS - (physicalRow % SEGMENT_ROWS);
      const count = Math.min(segmentCapacityLeft, this.pending.length - cursor);

      const payload = new Uint8Array(count * stride);
      for (let i = 0; i < count; i += 1) {
        payload.set(this.pending[cursor + i].bytes, i * stride);
      }

      const result = await api.appendEmbeddingSegment({
        fileName: segmentFileName(this.safeCacheId, segmentIndex),
        data: payload.buffer,
      });
      if (!result.success) {
        // Leave everything from here on buffered; the manifest still describes
        // only what was already durable, so nothing is lost or half-committed.
        this.pending = this.pending.slice(cursor);
        throw new Error(result.error || 'Failed to append embedding segment');
      }

      for (let i = 0; i < count; i += 1) {
        const item = this.pending[cursor + i];
        const row = physicalRow + i;
        this.rows[row] = [item.imageId, item.contentKey, 0];
        this.rowByImageId.set(item.imageId, row);
        this.dirtyRowChunks.add(Math.floor(row / ROW_INDEX_CHUNK_SIZE));
        committed.push({ imageId: item.imageId, row });
      }

      const descriptor = this.manifest.segments[segmentIndex];
      const rowsInSegment = (physicalRow % SEGMENT_ROWS) + count;
      if (descriptor) {
        descriptor.rowCount = rowsInSegment;
      } else {
        this.manifest.segments[segmentIndex] = {
          file: segmentFileName(this.safeCacheId, segmentIndex),
          rowCount: rowsInSegment,
        };
      }

      // Advance the manifest's row bookkeeping immediately after each segment
      // append succeeds, not once at the end of the loop: if a later iteration
      // throws, totalRows must already reflect what is durable on disk, or the
      // next flush computes firstRow from a stale value and reissues row
      // numbers a still-earlier append already claimed on disk.
      this.manifest.totalRows = physicalRow + count;
      this.manifest.liveRows = this.rowByImageId.size;
      this.manifest.rowChunkCount = Math.ceil(this.manifest.totalRows / ROW_INDEX_CHUNK_SIZE);
      this.manifestDirty = true;

      cursor += count;
    }

    this.manifest.updatedAt = Date.now();
    this.manifest.centroidSum = Array.from(this.centroidSum);
    this.manifest.centroidCount = this.centroidCount;
    this.pending = [];

    for (const chunk of this.dirtyRowChunks) {
      const start = chunk * ROW_INDEX_CHUNK_SIZE;
      const entries = this.rows.slice(start, start + ROW_INDEX_CHUNK_SIZE);
      const written = await api.writeEmbeddingFile({
        fileName: rowChunkFileName(this.safeCacheId, chunk),
        data: entries,
      });
      if (!written.success) {
        throw new Error(written.error || 'Failed to write embedding row chunk');
      }
    }
    this.dirtyRowChunks.clear();

    // Manifest last: it is what makes the rows above visible to the next load.
    const manifestWrite = await api.writeEmbeddingFile({
      fileName: manifestFileName(this.safeCacheId),
      data: this.manifest,
    });
    if (!manifestWrite.success) {
      throw new Error(manifestWrite.error || 'Failed to write embedding manifest');
    }
    this.manifestDirty = false;

    return committed;
  }

  /**
   * Segment metadata only — no disk read. Lets the caller decide which segments
   * actually changed (by rowCount) before paying for a read, rather than reading
   * every segment first and discarding the unchanged ones.
   */
  segmentDescriptors(): Array<{ index: number; rowCount: number }> {
    const descriptors: Array<{ index: number; rowCount: number }> = [];
    for (let index = 0; index < this.manifest.segments.length; index += 1) {
      const descriptor = this.manifest.segments[index];
      if (!descriptor || descriptor.rowCount === 0) continue;
      descriptors.push({ index, rowCount: descriptor.rowCount });
    }
    return descriptors;
  }

  /** Reads one segment's raw bytes for transfer into the search worker. */
  async readSegment(index: number): Promise<ArrayBuffer | null> {
    const descriptor = this.manifest.segments[index];
    if (!descriptor) return null;
    const api = getElectronAPI();
    const result = await api.readEmbeddingFile({ fileName: descriptor.file, binary: true });
    if (!result.success || !result.data) return null;
    return result.data as ArrayBuffer;
  }

  /** Image id for a physical row, used to map worker results back to images. */
  imageIdForRow(row: number): string | null {
    const entry = this.rows[row];
    return entry ? entry[0] : null;
  }

  rowSnapshot(): EmbeddingRowEntry[] {
    return this.rows;
  }
}

export const contentKeyForImage = (image: {
  fileSize?: number;
  contentModifiedMs?: number;
  lastModified?: number;
}): string => buildContentKey(image.fileSize, image.contentModifiedMs, image.lastModified);

export const deleteEmbeddingIndex = async (cacheId: string): Promise<boolean> => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api) return false;
  const result = await api.deleteEmbeddingIndex({ cacheId });
  return Boolean(result.success);
};

export const statEmbeddingIndex = async (cacheId: string): Promise<{ totalBytes: number; fileCount: number }> => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api) return { totalBytes: 0, fileCount: 0 };
  const result = await api.statEmbeddingIndex({ cacheId });
  return {
    totalBytes: result.success ? result.totalBytes ?? 0 : 0,
    fileCount: result.success ? result.fileCount ?? 0 : 0,
  };
};
