import {
  centroidFromLiveSegments,
  dotFloatWithQuantized,
  explodeSegment,
  rowHubnessScores,
  scoreRow,
  type ExplodedSegment,
} from '../embeddings/embeddingFormat';

/**
 * Holds the quantized vector matrix and ranks it against a query vector.
 *
 * Unlike the other workers in this app this one is long-lived and stateful:
 * the matrix reaches ~200MB on a 400k library, so reloading it per query is
 * not an option. It is created when visual search first activates and
 * terminated when the feature is switched off or the library changes.
 *
 * Ranking is brute force. At 400k rows a scan is ~205M int8 multiply-adds,
 * which lands inside the query budget for search-on-submit, and it avoids
 * maintaining an approximate index across incremental indexing, tombstones and
 * compaction. If the budget is ever missed, shard the segments across several
 * of these workers before reaching for HNSW.
 */

type WorkerMessage =
  | { type: 'init'; payload: { dim: number } }
  | { type: 'addSegment'; payload: { index: number; buffer: ArrayBuffer; rowCount: number } }
  | { type: 'setLiveMask'; payload: { mask: ArrayBuffer } }
  | { type: 'setResultMask'; payload: { mask: ArrayBuffer } }
  | { type: 'markDead'; payload: { rows: number[] } }
  | {
      type: 'query';
      payload: {
        queryId: number;
        codes: ArrayBuffer;
        scale: number;
        topK: number;
        minScore: number;
        /** Remove the library-mean axis from text↔image scores. */
        centered?: boolean;
      };
    }
  // Find Similar by content: the query vector is a row already in the matrix,
  // so it never has to be read back into the renderer.
  | { type: 'queryByRow'; payload: { queryId: number; row: number; topK: number; minScore: number } }
  | { type: 'dispose' };

type WorkerResponse =
  | { type: 'ready'; payload: { rowCount: number; segmentCount: number } }
  | {
      type: 'result';
      payload: {
        queryId: number;
        rows: number[];
        scores: number[];
        scannedRows: number;
        durationMs: number;
        // Distribution of scores over every scanned row, so the caller can pick
        // a relevance cutoff that adapts to the query. Computed here because the
        // worker already visits every row and the renderer only sees top-K.
        scoreSum: number;
        scoreSqSum: number;
      };
    }
  | { type: 'error'; payload: { error: string } };

const SEGMENTS: ExplodedSegment[] = [];
/** Physical row of the first row in each segment, parallel to SEGMENTS. */
const SEGMENT_BASE_ROW: number[] = [];
/** Per-row `v · mean̂`, parallel to SEGMENTS. Recomputed when mean moves. */
const SEGMENT_HUBNESS: Float32Array[] = [];

let dim = 0;
let totalRows = 0;
/** One byte per physical row: 0 = tombstoned or unknown, 1 = searchable. */
let liveMask: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
/** One byte per physical row: 1 = eligible to be returned to the current grid. */
let resultMask: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
/** Mean image vector, or null until the index is big enough to have one. */
let mean: Float32Array | null = null;
let meanDirty = true;

const refreshLiveMean = (): void => {
  if (!meanDirty) return;
  mean = centroidFromLiveSegments(SEGMENTS, SEGMENT_BASE_ROW, liveMask, dim);
  for (let s = 0; s < SEGMENTS.length; s += 1) {
    if (SEGMENTS[s]) SEGMENT_HUBNESS[s] = rowHubnessScores(SEGMENTS[s], dim, mean);
  }
  meanDirty = false;
};

const masksEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const post = (message: WorkerResponse, transfer?: Transferable[]) => {
  (self as unknown as Worker).postMessage(message, transfer ?? []);
};

/**
 * Fixed-size min-heap over (score, row). Only rows that beat the current
 * minimum pay for a heap operation, so past the first few thousand rows most
 * of the scan costs a single comparison.
 */
class TopK {
  private readonly scores: Float32Array;

  private readonly rows: Int32Array;

  private size = 0;

  constructor(private readonly capacity: number) {
    this.scores = new Float32Array(capacity);
    this.rows = new Int32Array(capacity);
  }

  get worst(): number {
    return this.size < this.capacity ? -Infinity : this.scores[0];
  }

  push(score: number, row: number): void {
    if (this.size < this.capacity) {
      let index = this.size;
      this.scores[index] = score;
      this.rows[index] = row;
      this.size += 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (this.scores[parent] <= this.scores[index]) break;
        this.swap(parent, index);
        index = parent;
      }
      return;
    }

    if (score <= this.scores[0]) return;
    this.scores[0] = score;
    this.rows[0] = row;
    this.siftDown();
  }

  private siftDown(): void {
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.size && this.scores[left] < this.scores[smallest]) smallest = left;
      if (right < this.size && this.scores[right] < this.scores[smallest]) smallest = right;
      if (smallest === index) return;
      this.swap(smallest, index);
      index = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const score = this.scores[a];
    this.scores[a] = this.scores[b];
    this.scores[b] = score;
    const row = this.rows[a];
    this.rows[a] = this.rows[b];
    this.rows[b] = row;
  }

  drainSorted(): { rows: number[]; scores: number[] } {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < this.size; i += 1) {
      pairs.push([this.scores[i], this.rows[i]]);
    }
    pairs.sort((a, b) => b[0] - a[0]);
    return {
      rows: pairs.map((pair) => pair[1]),
      scores: pairs.map((pair) => pair[0]),
    };
  }
}

const growMask = (mask: Uint8Array, requiredRows: number): Uint8Array => {
  if (mask.length >= requiredRows) return mask;
  const next = new Uint8Array(requiredRows);
  next.set(mask);
  // Rows added after the last mask sync are assumed live: they were just
  // appended by the indexer, which never appends a dead row.
  next.fill(1, mask.length);
  return next;
};

const locateRow = (physicalRow: number): { segment: ExplodedSegment; localRow: number } | null => {
  for (let s = 0; s < SEGMENTS.length; s += 1) {
    const segment = SEGMENTS[s];
    if (!segment) continue;
    const base = SEGMENT_BASE_ROW[s];
    if (physicalRow >= base && physicalRow < base + segment.rowCount) {
      return { segment, localRow: physicalRow - base };
    }
  }
  return null;
};

const runQuery = (
  queryCodes: Int8Array,
  queryScale: number,
  topK: number,
  minScore: number,
  centered = false
): { rows: number[]; scores: number[]; scannedRows: number; scoreSum: number; scoreSqSum: number } => {
  if (centered) refreshLiveMean();
  const heap = new TopK(Math.max(1, topK));
  let scanned = 0;
  let scoreSum = 0;
  let scoreSqSum = 0;

  // Remove only the component that the query and row share along the library's
  // mean direction:
  //   q·v - (q·mean̂)(v·mean̂)
  // This is the dot product of both vectors projected off the mean axis. The
  // previous fixed penalty `q·v - 1*(v·mean̂)` was not a centering analog: it
  // made ranking mostly "least average image" and could overwhelm the actual
  // text query. No row renormalization is used, so near-mean int8 noise is not
  // amplified.
  const useCentering = centered && mean !== null;
  let queryMeanAlignment = 0;
  if (useCentering && mean) {
    let meanNormSq = 0;
    for (let i = 0; i < dim; i += 1) meanNormSq += mean[i] * mean[i];
    const meanNorm = Math.sqrt(meanNormSq);
    if (meanNorm > 0) {
      queryMeanAlignment = dotFloatWithQuantized(mean, queryCodes, queryScale) / meanNorm;
    }
  }

  for (let s = 0; s < SEGMENTS.length; s += 1) {
    const segment = SEGMENTS[s];
    if (!segment) continue;
    const baseRow = SEGMENT_BASE_ROW[s];
    const { codes, scales, rowCount } = segment;
    const hubness = SEGMENT_HUBNESS[s];

    for (let row = 0; row < rowCount; row += 1) {
      const physicalRow = baseRow + row;
      if (liveMask[physicalRow] !== 1) continue;
      const eligibleResult = resultMask[physicalRow] === 1;
      // Text queries need the full hydrated-library distribution for a stable
      // centroid and cutoff even when the visible grid is tiny. Find Similar
      // has no distribution-based cutoff, so it only scans returnable rows.
      if (!centered && !eligibleResult) continue;
      scanned += 1;
      const raw = scoreRow(queryCodes, queryScale, codes, row * dim, dim, scales[row]);
      const score = useCentering && hubness
        ? raw - queryMeanAlignment * hubness[row]
        : raw;
      // Accumulate over every live row, before the heap gate, so mean/std
      // describe the whole library rather than just the top-K survivors.
      scoreSum += score;
      scoreSqSum += score * score;
      if (!eligibleResult) continue;
      if (score < minScore || score <= heap.worst) continue;
      heap.push(score, physicalRow);
    }
  }

  return { ...heap.drainSorted(), scannedRows: scanned, scoreSum, scoreSqSum };
};

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'init': {
        dim = message.payload.dim;
        SEGMENTS.length = 0;
        SEGMENT_BASE_ROW.length = 0;
        SEGMENT_HUBNESS.length = 0;
        totalRows = 0;
        liveMask = new Uint8Array(0);
        resultMask = new Uint8Array(0);
        mean = null;
        meanDirty = true;
        post({ type: 'ready', payload: { rowCount: 0, segmentCount: 0 } });
        break;
      }

      case 'addSegment': {
        const { index, buffer, rowCount } = message.payload;
        SEGMENTS[index] = explodeSegment(buffer, dim, rowCount);
        SEGMENT_HUBNESS[index] = new Float32Array(rowCount);
        // Segments are fixed-capacity and arrive in order, so the base row of a
        // segment is the running total of everything before it.
        let base = 0;
        for (let i = 0; i < index; i += 1) {
          base += SEGMENTS[i]?.rowCount ?? 0;
        }
        SEGMENT_BASE_ROW[index] = base;
        totalRows = Math.max(totalRows, base + SEGMENTS[index].rowCount);
        liveMask = growMask(liveMask, totalRows);
        resultMask = growMask(resultMask, totalRows);
        meanDirty = true;
        post({ type: 'ready', payload: { rowCount: totalRows, segmentCount: SEGMENTS.length } });
        break;
      }

      case 'setLiveMask': {
        const nextMask = new Uint8Array(message.payload.mask);
        if (!masksEqual(liveMask, nextMask)) {
          liveMask = nextMask;
          meanDirty = true;
        }
        break;
      }

      case 'setResultMask': {
        resultMask = new Uint8Array(message.payload.mask);
        break;
      }

      case 'markDead': {
        for (const row of message.payload.rows) {
          if (row >= 0 && row < liveMask.length) {
            if (liveMask[row] === 1) {
              liveMask[row] = 0;
              meanDirty = true;
            }
          }
          if (row >= 0 && row < resultMask.length) resultMask[row] = 0;
        }
        break;
      }

      case 'query': {
        const startedAt = performance.now();
        const { queryId, codes, scale, topK, minScore, centered } = message.payload;
        const result = runQuery(new Int8Array(codes), scale, topK, minScore, centered);
        post({
          type: 'result',
          payload: {
            queryId,
            rows: result.rows,
            scores: result.scores,
            scannedRows: result.scannedRows,
            durationMs: performance.now() - startedAt,
            scoreSum: result.scoreSum,
            scoreSqSum: result.scoreSqSum,
          },
        });
        break;
      }

      case 'queryByRow': {
        const startedAt = performance.now();
        const { queryId, row, topK, minScore } = message.payload;
        const located = locateRow(row);
        if (!located) {
          post({ type: 'result', payload: { queryId, rows: [], scores: [], scannedRows: 0, durationMs: 0, scoreSum: 0, scoreSqSum: 0 } });
          break;
        }
        const { segment, localRow } = located;
        const codes = new Int8Array(segment.codes.subarray(localRow * dim, (localRow + 1) * dim));
        const result = runQuery(codes, segment.scales[localRow], topK, minScore);
        post({
          type: 'result',
          payload: {
            queryId,
            rows: result.rows,
            scores: result.scores,
            scannedRows: result.scannedRows,
            durationMs: performance.now() - startedAt,
            scoreSum: result.scoreSum,
            scoreSqSum: result.scoreSqSum,
          },
        });
        break;
      }

      case 'dispose': {
        SEGMENTS.length = 0;
        SEGMENT_BASE_ROW.length = 0;
        SEGMENT_HUBNESS.length = 0;
        liveMask = new Uint8Array(0);
        resultMask = new Uint8Array(0);
        mean = null;
        totalRows = 0;
        break;
      }

      default:
        break;
    }
  } catch (error) {
    post({ type: 'error', payload: { error: error instanceof Error ? error.message : String(error) } });
  }
};

export type { WorkerMessage as VectorSearchWorkerMessage, WorkerResponse as VectorSearchWorkerResponse };
