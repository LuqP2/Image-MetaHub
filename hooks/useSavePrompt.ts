import { formatMessage } from '../i18n/messages.mjs';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCallback, useRef, useState } from 'react';
import type { IndexedImage, SavePromptInput, SavedPromptSaveResult, ShadowMetadata } from '../types';
import { getPersistedShadowMetadata } from '../services/userDataPersistenceAdapter';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import { buildEffectiveMetadata } from '../utils/editableMetadata';
import { getRelativeImagePath } from '../utils/imagePaths';
import { emptyEditor } from '../services/promptLibrary/core.mjs';

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
  if (!positivePrompt.trim() && !negativePrompt.trim()) throw new Error('This image has no prompt to save.');
  const editor = emptyEditor();
  editor.metadata = {
    model: effective?.model || '', generator: effective?.generator || '', sampler: effective?.sampler || '', scheduler: effective?.scheduler || '',
    loras: (effective?.loras || []).map((lora) => typeof lora === 'string' ? lora : lora.name || '').filter(Boolean),
  };
  return {
    positivePrompt,
    negativePrompt,
    textBasis: showOriginal ? 'original' : 'effective',
    editor,
    source: buildSavedPromptSource(image, directoryPath),
    sourceCreatedAt: Number.isFinite(image.lastModified) && image.lastModified > 0
      ? Math.trunc(image.lastModified)
      : null,
  };
}

export function useSavePrompt() {
  const persist = useSavedPromptStore((state) => state.save);
  return useCallback(async (
    image: IndexedImage,
    options: SavePromptOptions = {},
  ): Promise<SavedPromptSaveResult> => {
    if (options.shadowReady === false) throw new Error(formatMessage(useSettingsStore.getState().language, 'imageViewer.preview.promptLoading'));
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

function findMatchingPrompt(positivePrompt: unknown, negativePrompt: unknown) {
  const positive = typeof positivePrompt === 'string' ? positivePrompt : '';
  const negative = typeof negativePrompt === 'string' ? negativePrompt : '';
  return (prompts: ReturnType<typeof useSavedPromptStore.getState>['prompts']) =>
    positive.trim() || negative.trim()
      ? prompts.find(prompt => prompt.positivePrompt === positive && prompt.negativePrompt === negative)
      : undefined;
}

export function useIsPromptSaved(positivePrompt: unknown, negativePrompt: unknown): boolean {
  const findPrompt = findMatchingPrompt(positivePrompt, negativePrompt);
  return useSavedPromptStore(state => Boolean(findPrompt(state.prompts)));
}

export function usePromptBookmark(positivePrompt: unknown, negativePrompt: unknown) {
  const isPromptSaved = useIsPromptSaved(positivePrompt, negativePrompt);
  const savePrompt = useSavePrompt();
  const pending = useRef(false);
  const [isBookmarkPending, setIsBookmarkPending] = useState(false);

  const togglePromptBookmark = async (image: IndexedImage, options: SavePromptOptions) => {
    if (pending.current) return;
    pending.current = true;
    setIsBookmarkPending(true);
    try {
      const state = useSavedPromptStore.getState();
      const saved = findMatchingPrompt(positivePrompt, negativePrompt)(state.prompts);
      if (saved) {
        await state.remove(saved.id);
        return formatMessage(useSettingsStore.getState().language, 'imageViewer.preview.promptRemoved');
      }
      const result = await savePrompt(image, options);
      return formatMessage(useSettingsStore.getState().language, result.status === 'already-saved'
        ? 'imageViewer.preview.promptAlreadySaved'
        : 'imageViewer.preview.promptSaved');
    } finally {
      pending.current = false;
      setIsBookmarkPending(false);
    }
  };

  return { isPromptSaved, isBookmarkPending, togglePromptBookmark };
}
