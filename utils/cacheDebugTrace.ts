import type { Directory, IndexedImage } from '../types';

const DEBUG_STORAGE_KEY = 'image-metahub-debug-cache';

type CacheTracePayload = {
  directoryId?: string;
  imageIdsCount?: number;
  batchCount?: number;
  details?: Record<string, unknown>;
  snapshot?: {
    directories: number;
    visibleDirectories: string[];
    images: number;
    filteredImages: number;
    availableModels: number;
    availableLoras: number;
    availableSamplers: number;
    availableSchedulers: number;
    availableGenerators: number;
    availableGpuDevices: number;
    availableDimensions: number;
    selectedFolders: number;
    indexingState: 'idle' | 'indexing' | 'completed' | 'paused';
  };
};

type CacheDebugStateSnapshotInput = {
  directories: Directory[];
  images: IndexedImage[];
  filteredImages: IndexedImage[];
  availableModels: string[];
  availableLoras: string[];
  availableSamplers: string[];
  availableSchedulers: string[];
  availableGenerators: string[];
  availableGpuDevices: string[];
  availableDimensions: string[];
  selectedFolders: Set<string>;
  indexingState: 'idle' | 'indexing' | 'completed' | 'paused';
};

export const isCacheDebugEnabled = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export const createCacheDebugSnapshot = (
  state: CacheDebugStateSnapshotInput
) => ({
  directories: state.directories.length,
  visibleDirectories: state.directories
    .filter((directory) => directory.visible ?? true)
    .map((directory) => directory.id),
  images: state.images.length,
  filteredImages: state.filteredImages.length,
  availableModels: state.availableModels.length,
  availableLoras: state.availableLoras.length,
  availableSamplers: state.availableSamplers.length,
  availableSchedulers: state.availableSchedulers.length,
  availableGenerators: state.availableGenerators.length,
  availableGpuDevices: state.availableGpuDevices.length,
  availableDimensions: state.availableDimensions.length,
  selectedFolders: state.selectedFolders.size,
  indexingState: state.indexingState,
});

export const traceCacheDebug = (event: string, payloadFactory: () => CacheTracePayload) => {
  if (!isCacheDebugEnabled()) {
    return;
  }

  try {
    console.log(`[cache-debug] ${event}`, payloadFactory());
  } catch (error) {
    console.warn(`[cache-debug] ${event} failed`, error);
  }
};

export const countValidImages = (images: IndexedImage[]) => images.filter((image) => Boolean(image?.id)).length;
