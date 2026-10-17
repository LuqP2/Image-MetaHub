import type { Directory, IndexedImage } from '../types';

/** Called only after persisted directories and their cached images are hydrated. */
export async function resumeRecoveredEnrichment({
  consumeRecovery, directories, getImages, resume,
}: {
  consumeRecovery?: () => Promise<boolean>;
  directories: readonly Directory[];
  getImages: () => readonly Pick<IndexedImage, 'directoryId' | 'enrichmentState'>[];
  resume: (directory: Directory) => Promise<void>;
}): Promise<{ resumed: Set<string>; completion: Promise<void> }> {
  const resumed = new Set<string>();
  if (!await consumeRecovery?.()) return { resumed, completion: Promise.resolve() };
  const pending = new Set(getImages()
    .filter(image => image.enrichmentState === 'catalog')
    .map(image => image.directoryId));
  const unfinished = directories.filter(directory => !directory.transient && pending.has(directory.id));
  for (const directory of unfinished) resumed.add(directory.id);
  const completion = (async () => {
    for (const directory of unfinished) await resume(directory);
  })();
  // Hydration can finish while enrichment continues in the background.
  return { resumed, completion };
}
