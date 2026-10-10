import type { PromptLibraryItem } from '../../types';
export const exactText = (a: PromptLibraryItem, b: PromptLibraryItem) => 'text' in a ? 'text' in b && a.text === b.text : !('text' in b) && a.positivePrompt === b.positivePrompt && a.negativePrompt === b.negativePrompt;
const normalized = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
export function dice(a: string, b: string) {
  a = normalized(a);
  b = normalized(b);
  if(a === b)
    return 1;
  if(a.length < 3 || b.length < 3)
    return 0;
  const grams = (s: string) => new Set(Array.from({ length: s.length - 2 }, (_, i) => s.slice(i, i + 3)));
  const x = grams(a);
  const y = grams(b);
  return 2 * [...x].filter((g) => y.has(g)).length / (x.size + y.size);
}
export function findDuplicates(item: PromptLibraryItem, candidates: PromptLibraryItem[], similar: boolean) {
  return candidates.filter((p) => p.id !== item.id && ('text' in p) === ('text' in item)).map((candidate) => {
    const exact = exactText(item, candidate);
    const score = !similar ? (exact ? 1 : 0) : 'text' in item && 'text' in candidate ? dice(item.text, candidate.text)
      : !('text' in item) && !('text' in candidate) ? Math.min(dice(item.positivePrompt, candidate.positivePrompt), dice(item.negativePrompt, candidate.negativePrompt)) : 0;
    return { id: candidate.id, exact, score };
  }).filter((p) => p.exact || (similar && p.score >= .9)).sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score).slice(0, 20);
}
