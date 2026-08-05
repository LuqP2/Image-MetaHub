/**
 * Binary layout for the visual-search vector index.
 *
 * Vectors are stored in append-only segment files next to the metadata cache,
 * quantized to int8 with a per-vector scale. Per-vector scaling matters: CLIP
 * embeddings are L2-normalized, so on 512 dims the largest component is
 * typically ~0.15 and a fixed [-1,1] scale would waste more than two bits of
 * every value.
 *
 * On disk a row is interleaved (scale followed by its codes) so appending a
 * vector is a single write. In memory the segment is exploded into a flat code
 * array plus a scale array, which is what the similarity loop wants.
 */

export const EMBEDDING_FORMAT_VERSION = 2;

/** Rows per segment file. 8192 x 516B keeps a segment near 4MB. */
export const SEGMENT_ROWS = 8192;

/** Entries per row-index chunk, mirroring the metadata cache's chunking. */
export const ROW_INDEX_CHUNK_SIZE = 4096;

/** Bytes preceding the codes in a row: one float32 scale. */
export const ROW_HEADER_BYTES = 4;

export const rowStrideBytes = (dim: number): number => ROW_HEADER_BYTES + dim;

export const segmentByteLength = (rows: number, dim: number): number => rows * rowStrideBytes(dim);

/** Bit flags stored alongside each row-index entry. */
export const ROW_FLAG_TOMBSTONE = 1;

/**
 * A row-index entry, serialized as a positional array to keep the JSON small:
 * at 400k rows the object form costs roughly 30MB more.
 */
export type EmbeddingRowEntry = [imageId: string, contentKey: string, flags: number];

export interface EmbeddingSegmentDescriptor {
  file: string;
  rowCount: number;
}

export interface EmbeddingManifest {
  formatVersion: number;
  modelId: string;
  modelRevision: string;
  dim: number;
  quant: 'i8-pervec';
  segments: EmbeddingSegmentDescriptor[];
  rowChunkCount: number;
  totalRows: number;
  liveRows: number;
  tombstoneCount: number;
  updatedAt: number;
  /**
   * Running sum of every embedded image vector, and how many went into it. The
   * mean derived from these is what text queries are centered against (see
   * `centeredInverseNorms`). Stored as a sum rather than a mean so an
   * incremental backfill can extend it without revisiting existing rows.
   */
  centroidSum: number[];
  centroidCount: number;
}

/**
 * Rows needed before the centroid is trusted. Below this the mean is dominated
 * by whatever handful of images happened to be indexed first, and centering
 * against it would distort ranking rather than correct it.
 */
export const MIN_CENTROID_ROWS = 16;

/**
 * Identity of the file's *content*, used to detect that an image changed
 * underneath a stored vector. Mirrors the pair the thumbnail cache keys on.
 */
export const buildContentKey = (fileSize?: number, contentModifiedMs?: number, lastModified?: number): string => {
  const size = Number.isFinite(fileSize) ? Math.trunc(fileSize as number) : -1;
  const modified = Number.isFinite(contentModifiedMs)
    ? Math.trunc(contentModifiedMs as number)
    : Number.isFinite(lastModified)
      ? Math.trunc(lastModified as number)
      : -1;
  return `${size}:${modified}`;
};

export const createEmptyManifest = (
  modelId: string,
  modelRevision: string,
  dim: number
): EmbeddingManifest => ({
  formatVersion: EMBEDDING_FORMAT_VERSION,
  modelId,
  modelRevision,
  dim,
  quant: 'i8-pervec',
  segments: [],
  rowChunkCount: 0,
  totalRows: 0,
  liveRows: 0,
  tombstoneCount: 0,
  updatedAt: Date.now(),
  centroidSum: new Array(dim).fill(0),
  centroidCount: 0,
});

/**
 * A manifest written by a different model or format cannot be interpreted, and
 * embeddings are pure derived data, so the caller rebuilds instead of migrating.
 */
export const isManifestCompatible = (
  manifest: EmbeddingManifest | null,
  modelId: string,
  dim: number
): manifest is EmbeddingManifest => Boolean(
  manifest
  && manifest.formatVersion === EMBEDDING_FORMAT_VERSION
  && manifest.modelId === modelId
  && manifest.dim === dim
  && manifest.quant === 'i8-pervec'
);

export const segmentFileName = (safeCacheId: string, index: number): string =>
  `${safeCacheId}_emb_seg_${index}.bin`;

export const rowChunkFileName = (safeCacheId: string, index: number): string =>
  `${safeCacheId}_emb_rows_${index}.json`;

export const manifestFileName = (safeCacheId: string): string =>
  `${safeCacheId}_emb_manifest.json`;

export const l2Normalize = (vector: Float32Array): Float32Array => {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    sum += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sum);
  if (norm === 0) {
    return vector;
  }
  const inverse = 1 / norm;
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] *= inverse;
  }
  return vector;
};

export interface QuantizedVector {
  scale: number;
  codes: Int8Array;
}

/**
 * Quantizes an already-normalized vector. The scale is the largest magnitude in
 * the vector, so the codes always use the full int8 range.
 */
export const quantizeVector = (vector: Float32Array): QuantizedVector => {
  let maxAbs = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const magnitude = Math.abs(vector[i]);
    if (magnitude > maxAbs) {
      maxAbs = magnitude;
    }
  }

  const codes = new Int8Array(vector.length);
  if (maxAbs === 0) {
    return { scale: 0, codes };
  }

  const factor = 127 / maxAbs;
  for (let i = 0; i < vector.length; i += 1) {
    const scaled = Math.round(vector[i] * factor);
    codes[i] = scaled > 127 ? 127 : scaled < -127 ? -127 : scaled;
  }
  return { scale: maxAbs / 127, codes };
};

export const dequantizeVector = (codes: Int8Array, scale: number): Float32Array => {
  const vector = new Float32Array(codes.length);
  for (let i = 0; i < codes.length; i += 1) {
    vector[i] = codes[i] * scale;
  }
  return vector;
};

/** Writes one interleaved row into a segment buffer. */
export const writeRow = (
  target: Uint8Array,
  rowIndex: number,
  dim: number,
  quantized: QuantizedVector
): void => {
  const stride = rowStrideBytes(dim);
  const offset = rowIndex * stride;
  new DataView(target.buffer, target.byteOffset + offset, ROW_HEADER_BYTES)
    .setFloat32(0, quantized.scale, true);
  target.set(quantized.codes.subarray(0, dim), offset + ROW_HEADER_BYTES);
};

export const encodeRow = (dim: number, quantized: QuantizedVector): Uint8Array => {
  const row = new Uint8Array(rowStrideBytes(dim));
  writeRow(row, 0, dim, quantized);
  return row;
};

export interface ExplodedSegment {
  codes: Int8Array;
  scales: Float32Array;
  rowCount: number;
}

/**
 * Splits an interleaved segment into the flat arrays the similarity loop reads.
 * `declaredRows` comes from the manifest, which is the source of truth: a
 * segment longer than that holds rows from a flush that never committed, and
 * they are dropped here rather than trusted.
 */
export const explodeSegment = (
  buffer: ArrayBuffer,
  dim: number,
  declaredRows: number
): ExplodedSegment => {
  const stride = rowStrideBytes(dim);
  const storedRows = Math.floor(buffer.byteLength / stride);
  const rowCount = Math.max(0, Math.min(declaredRows, storedRows));

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const codes = new Int8Array(rowCount * dim);
  const scales = new Float32Array(rowCount);

  for (let row = 0; row < rowCount; row += 1) {
    const offset = row * stride;
    scales[row] = view.getFloat32(offset, true);
    const source = bytes.subarray(offset + ROW_HEADER_BYTES, offset + stride);
    codes.set(new Int8Array(source.buffer, source.byteOffset, dim), row * dim);
  }

  return { codes, scales, rowCount };
};

/**
 * Cosine similarity between a quantized query and a stored row.
 *
 * Both vectors were unit length before quantization, so the integer dot product
 * scaled by both per-vector scales recovers the cosine directly.
 */
export const scoreRow = (
  queryCodes: Int8Array,
  queryScale: number,
  segmentCodes: Int8Array,
  rowOffset: number,
  dim: number,
  rowScale: number
): number => {
  let accumulator = 0;
  let i = 0;
  // Unrolled: the loop runs once per row over the whole library, so the
  // per-iteration bounds check is the dominant cost at 400k rows.
  const unrolled = dim - (dim % 4);
  for (; i < unrolled; i += 4) {
    const base = rowOffset + i;
    accumulator += queryCodes[i] * segmentCodes[base]
      + queryCodes[i + 1] * segmentCodes[base + 1]
      + queryCodes[i + 2] * segmentCodes[base + 2]
      + queryCodes[i + 3] * segmentCodes[base + 3];
  }
  for (; i < dim; i += 1) {
    accumulator += queryCodes[i] * segmentCodes[rowOffset + i];
  }
  return accumulator * queryScale * rowScale;
};

/**
 * Mean image vector from a manifest's running sum, or null while the index is
 * too small for it to mean anything. Not re-normalized: the centering math
 * wants the actual mean, not a unit vector pointing at it.
 */
export const centroidFrom = (
  centroidSum: number[] | undefined,
  centroidCount: number | undefined,
  dim: number
): Float32Array | null => {
  if (!centroidSum || centroidSum.length !== dim) return null;
  if (!centroidCount || centroidCount < MIN_CENTROID_ROWS) return null;
  const mean = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) {
    mean[i] = centroidSum[i] / centroidCount;
  }
  return mean;
};

/**
 * Dot product of a float vector with a quantized one. Used to fold the constant
 * `mean · query` term out of the per-row centering math.
 */
export const dotFloatWithQuantized = (
  vector: Float32Array,
  codes: Int8Array,
  scale: number
): number => {
  let accumulator = 0;
  for (let i = 0; i < vector.length; i += 1) {
    accumulator += vector[i] * codes[i];
  }
  return accumulator * scale;
};

/**
 * Per-row hubness: the cosine between a stored vector and the unit vector
 * pointing at the library's mean. High means "this image looks like the average
 * of everything here" — the images that sit close to *every* query.
 *
 * This is the correction for CLIP's modality gap. Text and image towers occupy
 * near-disjoint cones, so raw text↔image cosines land in a narrow band whose
 * ordering is dominated by how generic each image is rather than by what the
 * query asked for. The worker scores `q·v − λ·hubness`, which subtracts that
 * generic component out.
 *
 * The earlier attempt scored `q·(v − mean) / ‖v − mean‖` instead. That is the
 * textbook centering formula and it is wrong for quantized vectors: a row near
 * the mean has a tiny `v − mean` whose direction is mostly int8 quantization
 * noise, and dividing by that tiny norm amplifies the noise to full scale. The
 * most generic images ended up with the highest — and essentially random —
 * scores. Penalizing hubness directly reorders the same way without ever
 * dividing by a near-zero quantity.
 *
 * Returns all-zeros when there is no mean yet, which degrades exactly to the
 * plain cosine (stored vectors are unit length).
 */
export const rowHubnessScores = (
  segment: ExplodedSegment,
  dim: number,
  mean: Float32Array | null
): Float32Array => {
  const hubness = new Float32Array(segment.rowCount);
  if (!mean) return hubness;

  // The mean's own length carries no ranking information — only the direction
  // it points does — so normalize once here rather than letting a tightly
  // clustered library scale every penalty up.
  let meanNorm = 0;
  for (let i = 0; i < dim; i += 1) meanNorm += mean[i] * mean[i];
  meanNorm = Math.sqrt(meanNorm);
  if (meanNorm === 0) return hubness;
  const inverseMeanNorm = 1 / meanNorm;

  for (let row = 0; row < segment.rowCount; row += 1) {
    const offset = row * dim;
    const scale = segment.scales[row];
    let dot = 0;
    for (let i = 0; i < dim; i += 1) {
      dot += segment.codes[offset + i] * mean[i];
    }
    hubness[row] = dot * scale * inverseMeanNorm;
  }
  return hubness;
};

export const isTombstoned = (entry: EmbeddingRowEntry): boolean =>
  (entry[2] & ROW_FLAG_TOMBSTONE) !== 0;
