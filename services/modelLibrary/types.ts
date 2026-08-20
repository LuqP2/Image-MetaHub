export type ModelSourceKind = 'lora' | 'checkpoint';

export interface ModelSource {
  id: string;
  name: string;
  path: string;
  kind: ModelSourceKind;
  recursive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ModelLocation {
  id: string;
  sourceId: string;
  sourceKind: ModelSourceKind;
  sourceName: string;
  relativePath: string;
  absolutePath: string;
  fileName: string;
  size: number;
  createdAt: number | null;
  modifiedAt: number | null;
  discoveredAt: number;
  lastSeenAt: number;
  fileMetadata?: ModelFileMetadata;
  sha256?: string;
  hashFingerprint?: { size: number; modifiedAt: number | null };
  civitai?: CivitaiModelMetadata | { status: 'notFound'; fetchedAt: number; url: string };
}

export interface ModelFileMetadata {
  modelName?: string;
  modelType?: string;
  baseModel?: string;
  architecture?: string;
  description?: string;
  triggerWords?: string[];
  raw: Record<string, string>;
  embeddedPreview?: string;
}

export interface CivitaiModelMetadata {
  modelId: number;
  versionId: number;
  modelName: string;
  versionName: string;
  modelType?: string;
  baseModel?: string;
  description?: string;
  trainedWords: string[];
  url: string;
  coverImage?: string;
  fetchedAt: number;
}

export interface ManagedModel {
  id: string;
  sha256: string;
  locationIds: string[];
}

export interface ModelCatalog {
  version: 1;
  locations: ModelLocation[];
  managedModels?: ManagedModel[];
  updatedAt: number;
}

export interface ModelSourceScanResult {
  sourceId: string;
  locations: Omit<ModelLocation, 'id' | 'sourceKind' | 'sourceName' | 'discoveredAt' | 'lastSeenAt'>[];
  error?: string;
}
