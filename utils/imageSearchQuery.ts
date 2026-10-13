/** Shared budget for compact image metadata and generated prompt queries. */
export const MAX_SEARCH_TEXT_LENGTH = 8192;

export function boundImageSearchQuery(prompt: string): string {
  const query = prompt.trim();
  // Metadata is lowercased before truncation; use the same range even when
  // lowercasing expands Unicode characters.
  const normalized = query.toLowerCase();
  return normalized.length <= MAX_SEARCH_TEXT_LENGTH
    ? query
    : normalized.slice(0, MAX_SEARCH_TEXT_LENGTH).trimEnd();
}
