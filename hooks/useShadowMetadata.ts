
import { useState, useEffect, useCallback } from 'react';
import { ShadowMetadata } from '../types';
import {
  getShadowMetadata,
  saveShadowMetadata as saveToStorage,
  deleteShadowMetadata as deleteFromStorage,
} from '../services/imageAnnotationsStorage';

export function useShadowMetadata(imageId?: string) {
  const [metadata, setMetadata] = useState<ShadowMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Fetch metadata when imageId changes
  useEffect(() => {
    let isMounted = true;

    if (!imageId) {
      setMetadata(null);
      return;
    }

    const fetchMetadata = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getShadowMetadata(imageId);
        if (isMounted) {
          setMetadata(data);
        }
      } catch (err) {
        if (isMounted) {
          console.error('Failed to fetch shadow metadata:', err);
          setError(err instanceof Error ? err : new Error('Unknown error'));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchMetadata();

    return () => {
      isMounted = false;
    };
  }, [imageId]);

  // Save metadata
  const saveMetadata = useCallback(
    async (updates: Partial<ShadowMetadata>) => {
      if (!imageId) return;

      try {
        // Merge existing with updates
        const newMetadata: ShadowMetadata = {
          imageId,
          updatedAt: Date.now(),
          ...metadata,
          ...updates,
        };

        await saveToStorage(newMetadata);
        setMetadata(newMetadata);
        return newMetadata;
      } catch (err) {
        console.error('Failed to save shadow metadata:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
        throw err;
      }
    },
    [imageId, metadata]
  );

  // Delete metadata
  const deleteMetadata = useCallback(async () => {
    if (!imageId) return;

    try {
      await deleteFromStorage(imageId);
      setMetadata(null);
    } catch (err) {
        console.error('Failed to delete shadow metadata:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
        throw err;
    }
  }, [imageId]);

  return {
    metadata,
    isLoading,
    error,
    saveMetadata,
    deleteMetadata,
  };
}
