/**
 * A1111 Models Hook
 * Fetches available models and LoRAs from A1111 API
 */

import { useState, useEffect, useCallback } from 'react';
import { A1111ApiClient } from '../services/a1111ApiClient';
import { useSettingsStore } from '../store/useSettingsStore';

export interface A1111Resources {
  models: string[];
  loras: string[];
  samplers: string[];
}

interface UseA1111ModelsReturn {
  resources: A1111Resources | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useA1111Models(): UseA1111ModelsReturn {
  const a1111ServerUrl = useSettingsStore((state) => state.a1111ServerUrl);
  const [resources, setResources] = useState<A1111Resources | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResources = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const client = new A1111ApiClient({ serverUrl: a1111ServerUrl });
      const [models, loras, samplers] = await Promise.all([
        client.getModelList(),
        client.getLoraList(),
        client.getSamplerList(),
      ]);

      setResources({ models, loras, samplers });
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch A1111 resources';
      setError(errorMessage);
      console.error('[useA1111Models] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [a1111ServerUrl]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  return {
    resources,
    isLoading,
    error,
    refresh: fetchResources,
  };
}
