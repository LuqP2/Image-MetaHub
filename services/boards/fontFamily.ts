const genericFamilies = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);

/** Generic CSS keywords stay bare; installed family names are quoted as a single name. */
export function boardFontFamily(family?: string): string | undefined {
  if (!family) return undefined;
  return genericFamilies.has(family.toLowerCase()) ? family : `${JSON.stringify(family)}, sans-serif`;
}
