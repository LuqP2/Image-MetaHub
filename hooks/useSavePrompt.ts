import { useCallback } from 'react';
import type { IndexedImage, SavePromptInput, SavedPromptSaveResult, ShadowMetadata } from '../types';
import { getPersistedShadowMetadata } from '../services/userDataPersistenceAdapter';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import { buildEffectiveMetadata } from '../utils/editableMetadata';
import { getRelativeImagePath } from '../utils/imagePaths';

interface SavePromptOptions {
  directoryPath?: string | null;
  showOriginal?: boolean;
  shadowMetadata?: ShadowMetadata | null;
  shadowReady?: boolean;
  readAuthoritativeShadow?: boolean;
}

export function buildSavedPromptSource(image: IndexedImage, directoryPath?: string | null): SavePromptInput['source'] {
  if (!window.electronAPI || !directoryPath) return null;
  const pathAtSave = {
    directoryPath,
    relativePath: getRelativeImagePath(image),
    fileSize: typeof image.fileSize === 'number' ? image.fileSize : null,
    contentModifiedMs: typeof image.contentModifiedMs === 'number' ? image.contentModifiedMs : null,
  };
  if (image.assetId && image.revisionId && image.provenanceLocationId && image.provenanceRootId) {
    return {
      kind: 'stable',
      reference: {
        assetId: image.assetId,
        revisionId: image.revisionId,
        locationId: image.provenanceLocationId,
        rootId: image.provenanceRootId,
      },
      pathAtSave,
    };
  }
  return { kind: 'path', pathAtSave };
}

export function composeSavedPromptInput(
  image: IndexedImage,
  shadowMetadata: ShadowMetadata | null | undefined,
  directoryPath?: string | null,
  showOriginal = false,
): SavePromptInput {
  const effective = buildEffectiveMetadata(
    image.metadata?.normalizedMetadata,
    shadowMetadata,
    showOriginal,
  );
  const positivePrompt = typeof effective?.prompt === 'string' ? effective.prompt : '';
  const negativePrompt = typeof effective?.negativePrompt === 'string' ? effective.negativePrompt : '';
  if (!positivePrompt.trim()) throw new Error('This image has no positive prompt to save.');
  return {
    positivePrompt,
    negativePrompt,
    textBasis: showOriginal ? 'original' : 'effective',
    source: buildSavedPromptSource(image, directoryPath),
  };
}

export function useSavePrompt() {
  const persist = useSavedPromptStore((state) => state.save);
  return useCallback(async (
    image: IndexedImage,
    options: SavePromptOptions = {},
  ): Promise<SavedPromptSaveResult> => {
    if (options.shadowReady === false) throw new Error('Prompt metadata is still loading.');
    let shadowMetadata = options.shadowMetadata;
    if (options.readAuthoritativeShadow) {
      shadowMetadata = await getPersistedShadowMetadata(image);
    }
    return persist(composeSavedPromptInput(
      image,
      shadowMetadata,
      options.directoryPath,
      Boolean(options.showOriginal),
    ));
  }, [persist]);
}
