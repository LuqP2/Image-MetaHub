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
}

export interface ModelCatalog {
  version: 1;
  locations: ModelLocation[];
  updatedAt: number;
}

export interface ModelSourceScanResult {
  sourceId: string;
  locations: Omit<ModelLocation, 'id' | 'sourceKind' | 'sourceName' | 'discoveredAt' | 'lastSeenAt'>[];
  error?: string;
}
