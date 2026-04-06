/**
 * ComfyUI Models Hook
 * Fetches available models, LoRAs, samplers, and schedulers from ComfyUI API
 */

import { useState, useEffect, useCallback } from 'react';
import { ComfyUIApiClient } from '../services/comfyUIApiClient';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  buildComfyUIResourceCatalog,
  type ComfyUIModelResource,
} from '../services/comfyUIWorkflowBuilder';

export interface ComfyUIResources {
  models: ComfyUIModelResource[];
  loras: string[];
  samplers: string[];
  schedulers: string[];
  objectInfo?: Record<string, any> | null;
}

interface UseComfyUIModelsReturn {
  resources: ComfyUIResources | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch and cache available ComfyUI resources
 */
export function useComfyUIModels(): UseComfyUIModelsReturn {
  const comfyUIServerUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const setComfyUIConnectionStatus = useSettingsStore((state) => state.setComfyUIConnectionStatus);
  const [resources, setResources] = useState<ComfyUIResources | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResources = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const client = new ComfyUIApiClient({ serverUrl: comfyUIServerUrl });
      const objectInfo = await client.getObjectInfo();
      const catalog = buildComfyUIResourceCatalog(objectInfo);

      setResources({
        models: catalog.models,
        loras: catalog.loras,
        samplers: catalog.samplers,
        schedulers: catalog.schedulers,
        objectInfo,
      });
      setComfyUIConnectionStatus('connected');

      console.log('[useComfyUIModels] Fetched resources:', {
        models: catalog.models.length,
        loras: catalog.loras.length,
        samplers: catalog.samplers.length,
        schedulers: catalog.schedulers.length,
      });
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch ComfyUI resources';
      setError(errorMessage);
      setComfyUIConnectionStatus('error');
      console.error('[useComfyUIModels] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [comfyUIServerUrl, setComfyUIConnectionStatus]);

  // Fetch on mount and when server URL changes
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
