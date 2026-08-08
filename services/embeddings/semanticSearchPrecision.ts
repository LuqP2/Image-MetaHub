export type SemanticSearchPrecision = 'broad' | 'balanced' | 'strict';

export const DEFAULT_SEMANTIC_SEARCH_PRECISION: SemanticSearchPrecision = 'balanced';

export const SEMANTIC_SEARCH_TOP_FRACTIONS: Record<SemanticSearchPrecision, number> = {
  broad: 0.55,
  balanced: 0.70,
  strict: 0.82,
};

export const sanitizeSemanticSearchPrecision = (value: unknown): SemanticSearchPrecision =>
  value === 'broad' || value === 'strict' || value === 'balanced'
    ? value
    : DEFAULT_SEMANTIC_SEARCH_PRECISION;

export const getSemanticSearchTopFraction = (value: unknown): number =>
  SEMANTIC_SEARCH_TOP_FRACTIONS[sanitizeSemanticSearchPrecision(value)];
