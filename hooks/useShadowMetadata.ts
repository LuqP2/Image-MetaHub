import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IndexedImage, ShadowMetadata, UserDataSemanticPatch } from '../types';
import {
  getPersistedShadowMetadata,
  patchShadowMetadata,
  registerStableUserDataImages,
  shadowFromStableRecord,
  subscribeStableUserDataChanges,
} from '../services/userDataPersistenceAdapter';

export function useShadowMetadata(image?: IndexedImage | string) {
  const imageId = typeof image === 'string' ? image : image?.id;
  const identityKey = typeof image === 'string'
    ? image
    : `${image?.id ?? ''}\0${image?.assetId ?? ''}\0${image?.revisionId ?? ''}\0${image?.provenanceLocationId ?? ''}`;
  const requestGeneration = useRef(0);
  const [metadata, setMetadata] = useState<ShadowMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const currentImage = useMemo(() => image, [identityKey]);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    if (!imageId) {
      setMetadata(null);
      return;
    }
    if (typeof currentImage !== 'string') registerStableUserDataImages([currentImage]);
    setIsLoading(true);
    setError(null);
    void getPersistedShadowMetadata(currentImage).then((value) => {
      if (requestGeneration.current === generation) setMetadata(value);
    }).catch((cause) => {
      if (requestGeneration.current !== generation) return;
      console.error('Failed to fetch shadow metadata:', cause);
      setError(cause instanceof Error ? cause : new Error('Unknown error'));
      setMetadata(null);
    }).finally(() => {
      if (requestGeneration.current === generation) setIsLoading(false);
    });

    return () => { requestGeneration.current += 1; };
  }, [currentImage, identityKey, imageId]);

  useEffect(() => subscribeStableUserDataChanges((records) => {
    if (!imageId || typeof currentImage === 'string' || !currentImage.assetId) return;
    for (const record of records) {
      if (record.domain !== 'shadow' || record.assetId !== currentImage.assetId) continue;
      setMetadata(shadowFromStableRecord(record, imageId));
    }
  }), [currentImage, identityKey, imageId]);

  const saveMetadata = useCallback(async (updates: Partial<ShadowMetadata>) => {
    if (!imageId) return undefined;
    const set: Record<string, unknown> = {};
    const remove: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'imageId' || key === 'assetId' || key === 'persistenceVersion') continue;
      if (value === null || value === undefined) remove.push(key);
      else set[key] = value;
    }
    try {
      const saved = await patchShadowMetadata(currentImage, { set, remove } satisfies UserDataSemanticPatch);
      setMetadata(saved);
      return saved ?? undefined;
    } catch (cause) {
      console.error('Failed to save shadow metadata:', cause);
      setError(cause instanceof Error ? cause : new Error('Unknown error'));
      throw cause;
    }
  }, [currentImage, imageId, identityKey]);

  const deleteMetadata = useCallback(async () => {
    if (!imageId) return;
    try {
      await patchShadowMetadata(currentImage, { deleteRecord: true });
      setMetadata(null);
    } catch (cause) {
      console.error('Failed to delete shadow metadata:', cause);
      setError(cause instanceof Error ? cause : new Error('Unknown error'));
      throw cause;
    }
  }, [currentImage, imageId, identityKey]);

  return { metadata, isLoading, error, saveMetadata, deleteMetadata };
}
