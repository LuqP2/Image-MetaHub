export type BoardObjectType = 'asset' | 'text' | 'frame';
export type BoardSide = 'top' | 'right' | 'bottom' | 'left';
export type BoardMediaType = 'image' | 'video' | 'audio' | 'model3d';
export type BoardMetadataField = 'model' | 'loras' | 'seed' | 'dimensions' | 'generator' | 'rating' | 'prompt';

export interface BoardAssetLocator {
  imageId: string;
  directoryPath: string | null;
  relativePath: string;
}

export interface BoardStableReference {
  assetId: string;
  revisionId: string;
  locationId: string;
  rootId: string;
}

export type BoardAssetReference =
  | ({ kind: 'stable'; locator: BoardAssetLocator } & BoardStableReference)
  | { kind: 'path'; locator: BoardAssetLocator };

export interface BoardObjectBase {
  id: string;
  type: BoardObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  frameId: string | null;
}

export interface BoardAssetObject extends BoardObjectBase {
  type: 'asset';
  reference: BoardAssetReference;
  name: string;
  mediaType: BoardMediaType;
  visibleFields: BoardMetadataField[];
}

export interface BoardTextObject extends BoardObjectBase {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
}

export interface BoardFrameObject extends BoardObjectBase {
  type: 'frame';
  frameId: null;
  title: string;
  color: string;
}

export type BoardObject = BoardAssetObject | BoardTextObject | BoardFrameObject;

export interface BoardConnection {
  id: string;
  type: 'manual';
  sourceObjectId: string;
  targetObjectId: string;
  sourceSide: BoardSide;
  targetSide: BoardSide;
  label: string;
  color: string;
}

export interface BoardDocument {
  schemaVersion: 1;
  id: string;
  revision: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  viewport: { x: number; y: number; zoom: number };
  objects: BoardObject[];
  connections: BoardConnection[];
}

export interface BoardSummary {
  id: string;
  name: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  objectCount: number;
  error?: string;
}

export interface BoardReferenceRemap {
  operationId: string;
  oldLocator: BoardAssetLocator;
  newLocator: BoardAssetLocator;
  stableReference?: BoardStableReference;
}

export type BoardApiResult<T> =
  | { success: true; data: T }
  | { success: false; code: string; error: string };

export interface BoardRepository {
  list(): Promise<BoardSummary[]>;
  load(id: string): Promise<BoardDocument>;
  save(document: BoardDocument, expectedRevision: number): Promise<BoardDocument>;
  remove(id: string, expectedRevision: number): Promise<void>;
  remapReferences(remaps: BoardReferenceRemap[]): Promise<void>;
  flush(): Promise<void>;
}

export interface BoardAssetInput {
  reference: BoardAssetReference;
  name: string;
  mediaType: BoardMediaType;
  width?: number;
  height?: number;
}
