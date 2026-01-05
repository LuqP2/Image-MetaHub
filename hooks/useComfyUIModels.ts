/**
 * ComfyUI Models Hook
 * Fetches available models, LoRAs, samplers, and schedulers from ComfyUI API
 */

import { useState, useEffect, useCallback } from 'react';
import { ComfyUIApiClient } from '../services/comfyUIApiClient';
import { useSettingsStore } from '../store/useSettingsStore';

export interface ComfyUIResources {
  checkpoints: string[];
  loras: string[];
  samplers: string[];
  schedulers: string[];
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
  const [resources, setResources] = useState<ComfyUIResources | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResources = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const client = new ComfyUIApiClient({ serverUrl: comfyUIServerUrl });
      const objectInfo = await client.getObjectInfo();

      // Parse CheckpointLoaderSimple for available checkpoints
      const checkpoints: string[] =
        objectInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];

      // Parse LoraLoader for available LoRAs
      const loras: string[] =
        objectInfo?.LoraLoader?.input?.required?.lora_name?.[0] || [];

      // Parse KSampler for available samplers and schedulers
      const samplers: string[] =
        objectInfo?.KSampler?.input?.required?.sampler_name?.[0] || [];

      const schedulers: string[] =
        objectInfo?.KSampler?.input?.required?.scheduler?.[0] || [];

      setResources({
        checkpoints,
        loras,
        samplers,
        schedulers,
      });

      console.log('[useComfyUIModels] Fetched resources:', {
        checkpoints: checkpoints.length,
        loras: loras.length,
        samplers: samplers.length,
        schedulers: schedulers.length,
      });
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch ComfyUI resources';
      setError(errorMessage);
      console.error('[useComfyUIModels] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [comfyUIServerUrl]);

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
