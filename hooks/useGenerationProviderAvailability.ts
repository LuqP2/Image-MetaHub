import { useMemo } from 'react';
import { useFeatureAccess } from './useFeatureAccess';
import { useSettingsStore } from '../store/useSettingsStore';

export type GenerationProviderId = 'a1111' | 'comfyui';

export interface VisibleGenerationProvider {
  id: GenerationProviderId;
  shortLabel: 'A1111' | 'ComfyUI';
  generateLabel: string;
  menuLabel: string;
  canUse: boolean;
}

export const useGenerationProviderAvailability = () => {
  const { canUseA1111, canUseComfyUI } = useFeatureAccess();
  const a1111Enabled = useSettingsStore((state) => state.a1111Enabled);
  const comfyUIEnabled = useSettingsStore((state) => state.comfyUIEnabled);

  const visibleProviders = useMemo<VisibleGenerationProvider[]>(() => {
    const providers: VisibleGenerationProvider[] = [];

    if (a1111Enabled) {
      providers.push({
        id: 'a1111',
        shortLabel: 'A1111',
        generateLabel: 'Generate (A1111)',
        menuLabel: 'with A1111 WebUI',
        canUse: canUseA1111,
      });
    }

    if (comfyUIEnabled) {
      providers.push({
        id: 'comfyui',
        shortLabel: 'ComfyUI',
        generateLabel: 'Generate (ComfyUI)',
        menuLabel: 'with ComfyUI',
        canUse: canUseComfyUI,
      });
    }

    return providers;
  }, [a1111Enabled, canUseA1111, canUseComfyUI, comfyUIEnabled]);

  const singleVisibleProvider = visibleProviders.length === 1 ? visibleProviders[0] : null;

  return {
    a1111Enabled,
    comfyUIEnabled,
    visibleProviders,
    singleVisibleProvider,
    hasVisibleProviders: visibleProviders.length > 0,
    hasMultipleVisibleProviders: visibleProviders.length > 1,
    headerButtonLabel: singleVisibleProvider?.generateLabel ?? 'Generate',
  };
};
