import type {
  ParsedSearchGroup,
  ParsedSearchQuery,
  ParsedSearchTerm,
  SearchFacetItem,
  SearchFacetState,
  SearchField,
  SearchImageResult,
  SearchMatchReason,
  SearchSessionResult,
  SearchSortMode,
  SearchSource,
  SearchWarning,
  StructuredSearchResult,
} from '../types';
import { SESSION_GAP_MS } from './imageGrouping';
import { formatLocalDateKey } from './dateFilterUtils';

export interface StructuredSearchDocument {
  id: string;
  name: string;
  prompt: string;
  negativePrompt: string;
  notes: string;
  tags: string[];
  models: string[];
  loras: string[];
  collections: string[];
  folder: string;
  source: SearchSource;
  lastModified: number;
}

const SEARCH_FIELDS: SearchField[] = [
  'prompt',
  'notes',
  'tag',
  'model',
  'lora',
  'collection',
  'folder',
  'source',
];

const SEARCH_SOURCES: SearchSource[] = [
  'comfyui',
  'a1111',
  'fooocus',
  'forge',
  'swarm',
  'drawthings',
  'invokeai',
  'midjourney',
  'other',
  'unknown',
];

const FIELD_WEIGHTS: Record<SearchMatchReason['field'], number> = {
  tag: 8,
  collection: 8,
  notes: 7,
  prompt: 7,
  model: 4,
  lora: 4,
  folder: 3,
  source: 3,
  filename: 2,
  negativePrompt: 0.5,
};

const FIELD_LABELS: Record<SearchMatchReason['field'], string> = {
  tag: 'Tag',
  collection: 'Collection',
  notes: 'Notes',
  prompt: 'Prompt',
  model: 'Model',
  lora: 'LoRA',
  folder: 'Folder',
  source: 'Source',
  filename: 'Filename',
  negativePrompt: 'Negative prompt',
};

const emptyFacets = (): SearchFacetState => ({
  models: [],
  loras: [],
  collections: [],
  dates: [],
  sessions: [],
});

export const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const damerauLevenshtein = (left: string, right: string, maxDistance: number): number => {
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  const matrix = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let index = 0; index <= left.length; index += 1) matrix[index][0] = index;
  for (let index = 0; index <= right.length; index += 1) matrix[0][index] = index;

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let rowMinimum = maxDistance + 1;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      let distance = Math.min(
        matrix[leftIndex - 1][rightIndex] + 1,
        matrix[leftIndex][rightIndex - 1] + 1,
        matrix[leftIndex - 1][rightIndex - 1] + cost,
      );

      if (
        leftIndex > 1 &&
        rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        distance = Math.min(distance, matrix[leftIndex - 2][rightIndex - 2] + cost);
      }

      matrix[leftIndex][rightIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > maxDistance) return maxDistance + 1;
  }

  return matrix[left.length][right.length];
};

const closestField = (field: string): string | undefined => {
  const normalized = normalizeSearchText(field);
  return SEARCH_FIELDS
    .map((candidate) => ({ candidate, distance: damerauLevenshtein(normalized, candidate, 2) }))
    .filter((entry) => entry.distance <= 2)
    .sort((left, right) => left.distance - right.distance)[0]?.candidate;
};

const parseDate = (value: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const tokenizeQuery = (query: string): string[] =>
  query.match(/-?(?:[A-Za-z]+:)?(?:"[^"]*"|[^\s]+)/g) ?? [];

export const parseStructuredSearchQuery = (raw: string): ParsedSearchQuery => {
  const warnings: SearchWarning[] = [];
  if (/[()]/.test(raw)) {
    warnings.push({
      code: 'unsupported-parentheses',
      token: raw,
      message: 'Parentheses are not supported in search yet and were treated as punctuation.',
    });
  }

  const groups: ParsedSearchGroup[] = [{ terms: [] }];
  let after: number | undefined;
  let before: number | undefined;

  for (const rawToken of tokenizeQuery(raw.replace(/[()]/g, ' '))) {
    if (rawToken.toUpperCase() === 'OR') {
      if (groups[groups.length - 1].terms.length > 0) groups.push({ terms: [] });
      continue;
    }

    const excluded = rawToken.startsWith('-');
    const token = excluded ? rawToken.slice(1) : rawToken;
    const fieldMatch = token.match(/^([A-Za-z]+):(.*)$/);
    const rawField = fieldMatch?.[1]?.toLowerCase();
    let rawValue = fieldMatch ? fieldMatch[2] : token;
    const phrase = rawValue.startsWith('"') && rawValue.endsWith('"');
    if (phrase) rawValue = rawValue.slice(1, -1);
    if (!rawValue.trim()) continue;

    if (rawField === 'after' || rawField === 'before') {
      const parsedDate = parseDate(rawValue);
      if (parsedDate === null) {
        warnings.push({
          code: 'invalid-date',
          token: rawToken,
          message: `Invalid ${rawField} date "${rawValue}". Use YYYY-MM-DD.`,
        });
      } else if (rawField === 'after') {
        after = parsedDate;
      } else {
        before = parsedDate + (24 * 60 * 60 * 1000);
      }
      continue;
    }

    let field: SearchField | undefined;
    let termValue = rawValue;
    if (rawField) {
      if (SEARCH_FIELDS.includes(rawField as SearchField)) {
        field = rawField as SearchField;
      } else {
        const suggestion = closestField(rawField);
        warnings.push({
          code: 'unknown-field',
          token: rawToken,
          suggestion,
          message: `Unknown field "${rawField}"; searched as plain text.${suggestion ? ` Did you mean "${suggestion}:"?` : ''}`,
        });
        termValue = `${rawField}:${rawValue}`;
      }
    }

    if (field === 'source') {
      const normalizedSource = normalizeSearchText(rawValue) as SearchSource;
      if (!SEARCH_SOURCES.includes(normalizedSource)) {
        warnings.push({
          code: 'invalid-source',
          token: rawToken,
          message: `Unknown source "${rawValue}".`,
        });
      }
    }

    const normalizedValue = normalizeSearchText(termValue);
    if (!normalizedValue) continue;
    const term: ParsedSearchTerm = { value: termValue, normalizedValue, field, phrase, excluded };
    groups[groups.length - 1].terms.push(term);
  }

  return {
    raw,
    groups: groups.filter((group) => group.terms.length > 0),
    after,
    before,
    warnings,
  };
};

const documentFields = (document: StructuredSearchDocument) => ({
  prompt: [document.prompt],
  notes: [document.notes],
  tag: document.tags,
  model: document.models,
  lora: document.loras,
  collection: document.collections,
  folder: [document.folder],
  source: [document.source],
  filename: [document.name],
  negativePrompt: [document.negativePrompt],
});

type MatchCandidate = {
  field: SearchMatchReason['field'];
  value: string;
  term: string;
  matchType: SearchMatchReason['matchType'];
  score: number;
};

const matchValue = (term: ParsedSearchTerm, field: SearchMatchReason['field'], rawValue: string): MatchCandidate | null => {
  const value = normalizeSearchText(rawValue);
  if (!value) return null;
  const weight = FIELD_WEIGHTS[field];

  if (field === 'source' && value !== term.normalizedValue) {
    return null;
  }

  if (term.phrase && value.includes(term.normalizedValue)) {
    return { field, value: rawValue, term: term.normalizedValue, matchType: 'phrase', score: weight * 1.4 };
  }

  const termTokens = term.normalizedValue.split(' ');
  const valueTokens = value.split(' ');
  let multiplier = Number.POSITIVE_INFINITY;
  let resolvedType: SearchMatchReason['matchType'] = 'typo';

  for (const termToken of termTokens) {
    let tokenMultiplier = 0;
    let tokenType: SearchMatchReason['matchType'] | null = null;
    for (const valueToken of valueTokens) {
      if (valueToken === termToken) {
        tokenMultiplier = 1;
        tokenType = 'exact';
        break;
      }
      if (termToken.length >= 3 && valueToken.startsWith(termToken) && tokenMultiplier < 0.82) {
        tokenMultiplier = 0.82;
        tokenType = 'prefix';
      }
      if (termToken.length >= 4) {
        const maxDistance = termToken.length >= 8 ? 2 : 1;
        const distance = damerauLevenshtein(termToken, valueToken, maxDistance);
        const fuzzyMultiplier = distance <= maxDistance ? (distance === 1 ? 0.62 : 0.48) : 0;
        if (fuzzyMultiplier > tokenMultiplier) {
          tokenMultiplier = fuzzyMultiplier;
          tokenType = 'typo';
        }
      }
    }
    if (!tokenType) return null;
    if (tokenMultiplier < multiplier) {
      multiplier = tokenMultiplier;
      resolvedType = tokenType;
    }
  }

  return {
    field,
    value: rawValue,
    term: term.normalizedValue,
    matchType: resolvedType,
    score: weight * multiplier,
  };
};

const fieldsForTerm = (
  term: ParsedSearchTerm,
  fields: ReturnType<typeof documentFields>,
): Array<[SearchMatchReason['field'], string[]]> => {
  if (term.field) return [[term.field, fields[term.field]]];
  return Object.entries(fields) as Array<[SearchMatchReason['field'], string[]]>;
};

const matchTerm = (
  document: StructuredSearchDocument,
  term: ParsedSearchTerm,
): MatchCandidate | null => {
  const fields = documentFields(document);
  let best: MatchCandidate | null = null;
  for (const [field, values] of fieldsForTerm(term, fields)) {
    for (const value of values) {
      const candidate = matchValue(term, field, value);
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }
  }
  return best;
};

const matchGroup = (
  document: StructuredSearchDocument,
  group: ParsedSearchGroup,
): SearchImageResult | null => {
  const positiveMatches: MatchCandidate[] = [];
  for (const term of group.terms) {
    const candidate = matchTerm(document, term);
    if (term.excluded) {
      if (candidate) return null;
      continue;
    }
    if (!candidate) return null;
    positiveMatches.push(candidate);
  }

  if (positiveMatches.length === 0) return null;
  const fieldCounts = new Map<string, number>();
  for (const match of positiveMatches) fieldCounts.set(match.field, (fieldCounts.get(match.field) ?? 0) + 1);
  const cohesionBonus = Math.max(0, ...Array.from(fieldCounts.values())) > 1 ? 1.15 : 1;
  const sharedValueMatches = positiveMatches.filter((match) =>
    positiveMatches.filter((candidate) => candidate.field === match.field && candidate.value === match.value).length > 1
  );
  const proximityBonus = sharedValueMatches.length > 1 && (() => {
    const normalizedValue = normalizeSearchText(sharedValueMatches[0].value);
    const positions = sharedValueMatches.map((match) => normalizedValue.indexOf(match.term)).filter((position) => position >= 0);
    return positions.length > 1 && Math.max(...positions) - Math.min(...positions) <= 40;
  })() ? 1.08 : 1;
  const score = Math.min(60, positiveMatches.reduce((sum, match) => sum + match.score, 0) * cohesionBonus * proximityBonus);
  const reasons = positiveMatches
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map<SearchMatchReason>((match) => ({
      field: match.field,
      label: FIELD_LABELS[match.field],
      value: match.value,
      matchType: match.matchType,
      score: match.score,
    }));

  return { imageId: document.id, score, reasons };
};

export const matchStructuredSearchDocument = (
  document: StructuredSearchDocument,
  query: ParsedSearchQuery,
): SearchImageResult | null => {
  if (query.after !== undefined && document.lastModified < query.after) return null;
  if (query.before !== undefined && document.lastModified >= query.before) return null;

  let best: SearchImageResult | null = null;
  for (const group of query.groups) {
    const result = matchGroup(document, group);
    if (result && (!best || result.score > best.score)) best = result;
  }
  return best;
};

const countValues = (documents: StructuredSearchDocument[], selector: (document: StructuredSearchDocument) => string[]): SearchFacetItem[] => {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const uniqueValues = new Set(selector(document).filter(Boolean));
    for (const value of uniqueValues) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, 30);
};

const matchesFacetQuery = (
  document: StructuredSearchDocument,
  query: ParsedSearchQuery,
  ignoredField: SearchField | 'date',
): boolean => {
  if (ignoredField !== 'date') {
    if (query.after !== undefined && document.lastModified < query.after) return false;
    if (query.before !== undefined && document.lastModified >= query.before) return false;
  }

  return query.groups.some((group) => {
    for (const term of group.terms) {
      if (term.field === ignoredField) continue;
      const candidate = matchTerm(document, term);
      if (term.excluded ? Boolean(candidate) : !candidate) return false;
    }
    return true;
  });
};

const facetDocuments = (
  documents: StructuredSearchDocument[],
  query: ParsedSearchQuery,
  ignoredField: SearchField | 'date',
): StructuredSearchDocument[] =>
  documents.filter((document) => matchesFacetQuery(document, query, ignoredField));

const chooseDominantValue = (documents: StructuredSearchDocument[], selector: (document: StructuredSearchDocument) => string[], best: StructuredSearchDocument): string | undefined => {
  const counts = new Map<string, number>();
  for (const document of documents) {
    for (const value of new Set(selector(document).filter(Boolean))) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || Number(selector(best).includes(right[0])) - Number(selector(best).includes(left[0])) || left[0].localeCompare(right[0]))[0]?.[0];
};

const cleanTitle = (value: string, maxLength = 90): string => {
  const firstLine = value.split(/\r?\n/)[0].replace(/\s+/g, ' ').trim();
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 1).trimEnd()}…` : firstLine;
};

const buildSessionTitle = (documents: StructuredSearchDocument[], best: StructuredSearchDocument): string => {
  const note = documents.map((document) => cleanTitle(document.notes, 72)).find((value) => value.length > 0);
  if (note) return note;
  const collection = chooseDominantValue(documents, (document) => document.collections, best);
  if (collection) return collection;
  const prompt = cleanTitle(best.prompt);
  if (prompt) return prompt;
  const folder = cleanTitle(best.folder, 72);
  return folder || 'Untitled session';
};

export const buildStructuredSearchResult = (
  scopedDocuments: StructuredSearchDocument[],
  rawQuery: string,
  sortMode: SearchSortMode = 'relevance',
): StructuredSearchResult => {
  const query = parseStructuredSearchQuery(rawQuery);
  if (query.groups.length === 0) {
    return { sessions: [], facets: emptyFacets(), warnings: query.warnings, matchedImageCount: 0, totalSessionImageCount: 0 };
  }

  const sortedDocuments = [...scopedDocuments].sort((left, right) => left.lastModified - right.lastModified || left.id.localeCompare(right.id));
  const documentSessions: StructuredSearchDocument[][] = [];
  let currentSession: StructuredSearchDocument[] = [];
  for (const document of sortedDocuments) {
    const previous = currentSession[currentSession.length - 1];
    if (previous && document.lastModified - previous.lastModified > SESSION_GAP_MS) {
      documentSessions.push(currentSession);
      currentSession = [];
    }
    currentSession.push(document);
  }
  if (currentSession.length > 0) documentSessions.push(currentSession);

  const sessions: SearchSessionResult[] = [];
  const allMatchedDocuments: StructuredSearchDocument[] = [];
  for (const documents of documentSessions) {
    const imageResults = documents
      .map((document) => matchStructuredSearchDocument(document, query))
      .filter((result): result is SearchImageResult => result !== null)
      .sort((left, right) => right.score - left.score);
    if (imageResults.length === 0) continue;

    const byId = new Map(documents.map((document) => [document.id, document]));
    const bestDocument = byId.get(imageResults[0].imageId) ?? documents[documents.length - 1];
    const topResults = imageResults.slice(0, 5);
    const bestScore = topResults[0]?.score ?? 0;
    const topAverage = topResults.reduce((sum, result) => sum + result.score, 0) / Math.max(1, topResults.length);
    const matchRatio = imageResults.length / documents.length;
    const cappedMatchCount = Math.min(imageResults.length, 10) / 10;
    const score = (bestScore * 0.6) + (topAverage * 0.2) + (matchRatio * 9) + (cappedMatchCount * 3);
    const startTime = documents[0].lastModified;
    const endTime = documents[documents.length - 1].lastModified;
    const session: SearchSessionResult = {
      id: `session-${startTime}-${documents[0].id}`,
      title: buildSessionTitle(documents, bestDocument),
      startTime,
      endTime,
      imageIds: documents.map((document) => document.id),
      matchedImageIds: imageResults.map((result) => result.imageId),
      imageResults,
      representativeImageId: bestDocument.id,
      dominantModel: chooseDominantValue(documents, (document) => document.models, bestDocument),
      score,
    };
    sessions.push(session);
    for (const result of imageResults) {
      const matchedDocument = byId.get(result.imageId);
      if (matchedDocument) allMatchedDocuments.push(matchedDocument);
    }
  }

  sessions.sort((left, right) => {
    if (sortMode === 'newest') return right.endTime - left.endTime || right.score - left.score;
    if (sortMode === 'largest-batch') return right.imageIds.length - left.imageIds.length || right.score - left.score;
    return right.score - left.score || right.endTime - left.endTime;
  });

  const facets: SearchFacetState = {
    models: countValues(facetDocuments(scopedDocuments, query, 'model'), (document) => document.models),
    loras: countValues(facetDocuments(scopedDocuments, query, 'lora'), (document) => document.loras),
    collections: countValues(facetDocuments(scopedDocuments, query, 'collection'), (document) => document.collections),
    dates: countValues(facetDocuments(scopedDocuments, query, 'date'), (document) => [formatLocalDateKey(document.lastModified)]),
    sessions: sessions.slice(0, 30).map((session) => ({ value: session.id, count: session.matchedImageIds.length })),
  };

  return {
    sessions,
    facets,
    warnings: query.warnings,
    matchedImageCount: allMatchedDocuments.length,
    totalSessionImageCount: sessions.reduce((sum, session) => sum + session.imageIds.length, 0),
  };
};
