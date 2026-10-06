import type { ModelLocalMetadata } from './types';

export function mergeModelMetadata(local: ModelLocalMetadata, canonical: ModelLocalMetadata | undefined, sha256: string): ModelLocalMetadata {
  // Latest record wins scalar conflicts; ties favor the existing SHA identity.
  const localWins = !canonical || local.updatedAt > canonical.updatedAt;
  const older = localWins ? canonical : local;
  const newer = localWins ? local : canonical;
  const notes = [...new Set([newer?.notes, older?.notes].filter((note): note is string => Boolean(note)))];
  return {
    ...older, ...newer!, id: `sha256:${sha256}`, sha256, locationId: undefined,
    notes: notes.length ? notes.join('\n\n---\n\n') : undefined,
    tags: [...new Set([...(local.tags ?? []), ...(canonical?.tags ?? [])])],
    examples: [...new Map([...(older?.examples ?? []), ...(newer?.examples ?? [])].map((example) => [example.id, example])).values()],
  };
}
