import type { IndexedImage } from '../types';

/** Stable fingerprint of the ordered IDs that define one semantic-query scope. */
export const semanticSearchScopeRevision = (
  images: readonly Pick<IndexedImage, 'id'>[]
): string => {
  let primary = 0x811c9dc5;
  let secondary = 0x9e3779b9;

  for (const image of images) {
    const id = image.id;
    for (let index = 0; index < id.length; index += 1) {
      const code = id.charCodeAt(index);
      primary = Math.imul(primary ^ code, 0x01000193);
      secondary = Math.imul(secondary + code + index, 0x85ebca6b);
    }
    primary = Math.imul(primary ^ 0xff, 0x01000193);
    secondary = Math.imul(secondary ^ id.length, 0xc2b2ae35);
  }

  return `${images.length}:${primary >>> 0}:${secondary >>> 0}`;
};

export const summarizeScorePercentiles = (
  scores: readonly number[]
): { p50: number | null; p90: number | null; p95: number | null } => {
  if (scores.length === 0) return { p50: null, p90: null, p95: null };
  const sorted = [...scores].sort((left, right) => left - right);
  const at = (percentile: number): number => {
    const index = Math.min(sorted.length - 1, Math.floor(percentile * sorted.length));
    return sorted[index];
  };
  return { p50: at(0.50), p90: at(0.90), p95: at(0.95) };
};

export const isSemanticQuerySnapshotCurrent = (
  generation: number,
  currentGeneration: number,
  scopeRevision: string,
  currentScopeRevision: string
): boolean => generation === currentGeneration && scopeRevision === currentScopeRevision;

export interface DiagnosticIdMapper {
  get: (imageId: string) => string;
  reset: () => void;
}

/** Session-local aliases keep filesystem paths out of development diagnostics. */
export const createDiagnosticIdMapper = (): DiagnosticIdMapper => {
  let nextId = 1;
  const aliases = new Map<string, string>();
  return {
    get: (imageId) => {
      const existing = aliases.get(imageId);
      if (existing) return existing;
      const alias = `img-${nextId.toString(36)}`;
      nextId += 1;
      aliases.set(imageId, alias);
      return alias;
    },
    reset: () => {
      aliases.clear();
      nextId = 1;
    },
  };
};

export interface TextCandidateScoreDiagnostic {
  imageId: string;
  score: number;
  relativeToBest: number;
  accepted: boolean;
}

export interface VisualNeighborScoreDiagnostic {
  imageId: string;
  score: number;
}

export interface CorrelatedNeighborDiagnostic extends VisualNeighborScoreDiagnostic {
  textRank: number | null;
  textScore: number | null;
  textRelativeToBest: number | null;
  textAccepted: boolean | null;
}

/** Joins already-computed technical scores; it never inspects image metadata. */
export const correlateVisualNeighborsWithText = (
  neighbors: readonly VisualNeighborScoreDiagnostic[],
  textCandidates: readonly TextCandidateScoreDiagnostic[]
): CorrelatedNeighborDiagnostic[] => {
  const textById = new Map(textCandidates.map((candidate, index) => [
    candidate.imageId,
    { ...candidate, rank: index + 1 },
  ]));

  return neighbors.map((neighbor) => {
    const text = textById.get(neighbor.imageId);
    return {
      ...neighbor,
      textRank: text?.rank ?? null,
      textScore: text?.score ?? null,
      textRelativeToBest: text?.relativeToBest ?? null,
      textAccepted: text?.accepted ?? null,
    };
  });
};

/** Derives the public query state from the cards that survived every grid filter. */
export const summarizeVisibleSemanticResults = (
  visibleImages: readonly Pick<IndexedImage, 'id'>[],
  scoreById: ReadonlyMap<string, number>,
  excludedImageId?: string
): { count: number; topScore: number | null } => {
  let count = 0;
  let topScore: number | null = null;
  for (const image of visibleImages) {
    if (image.id === excludedImageId) continue;
    const score = scoreById.get(image.id);
    if (score === undefined) continue;
    count += 1;
    if (topScore === null || score > topScore) topScore = score;
  }
  return { count, topScore };
};
