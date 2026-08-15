import type { SemanticHit } from './semanticSearchEngine';
import type { SemanticSearchPrecision } from './semanticSearchPrecision';

export interface SemanticExpansionHit extends SemanticHit {
  source: 'text' | 'visual-expansion';
  visualSimilarity: number | null;
}

export interface SemanticExpansionResult {
  hits: SemanticExpansionHit[];
  applied: boolean;
  seedImageId: string | null;
  corroboratingImageIds: string[];
  expandedImageIds: string[];
}

/**
 * Adds one non-transitive visual neighborhood around the best text hit.
 * Expansion is allowed only when another independently accepted text hit
 * corroborates that neighborhood. Strict remains purely text-ranked.
 */
export const applyCorroboratedVisualExpansion = (
  textHits: readonly SemanticHit[],
  visualNeighbors: readonly SemanticHit[],
  precision: SemanticSearchPrecision,
  limit: number
): SemanticExpansionResult => {
  const seed = textHits[0];
  const textIds = new Set(textHits.map((hit) => hit.imageId));
  const corroboratingImageIds = seed
    ? visualNeighbors
        .filter((neighbor) => textIds.has(neighbor.imageId))
        .map((neighbor) => neighbor.imageId)
    : [];
  const canExpand = precision !== 'strict' && Boolean(seed) && corroboratingImageIds.length > 0;

  if (!seed || !canExpand) {
    return {
      hits: textHits.slice(0, limit).map((hit) => ({
        ...hit,
        source: 'text',
        visualSimilarity: null,
      })),
      applied: false,
      seedImageId: seed?.imageId ?? null,
      corroboratingImageIds,
      expandedImageIds: [],
    };
  }

  const combined = new Map<string, SemanticExpansionHit>();
  for (const hit of textHits) {
    combined.set(hit.imageId, { ...hit, source: 'text', visualSimilarity: null });
  }

  for (const neighbor of visualNeighbors) {
    const boundedSimilarity = Math.min(1, Math.max(0, neighbor.score));
    const propagatedScore = seed.score * boundedSimilarity;
    const existing = combined.get(neighbor.imageId);
    if (existing) {
      if (propagatedScore > existing.score) {
        combined.set(neighbor.imageId, {
          ...existing,
          score: propagatedScore,
          visualSimilarity: neighbor.score,
        });
      }
      continue;
    }
    combined.set(neighbor.imageId, {
      imageId: neighbor.imageId,
      score: propagatedScore,
      source: 'visual-expansion',
      visualSimilarity: neighbor.score,
    });
  }

  const hits = [...combined.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  return {
    hits,
    applied: true,
    seedImageId: seed.imageId,
    corroboratingImageIds,
    expandedImageIds: hits
      .filter((hit) => hit.source === 'visual-expansion')
      .map((hit) => hit.imageId),
  };
};
