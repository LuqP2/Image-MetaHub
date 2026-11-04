import type { BoardSmartFrameObject } from './queryTypes';
export type { BoardSmartFrameObject } from './queryTypes';
export type BoardObjectType = 'asset' | 'text' | 'frame' | 'smart-frame' | 'sticky' | 'shape' | 'link';
export type BoardTool = 'select' | 'text' | 'frame' | 'connect' | 'sticky' | 'rectangle' | 'ellipse' | 'diamond';
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
  | ({ kind: 'stable'; locator: BoardAssetLocator; appliedRemapIds?: string[] } & BoardStableReference)
  | { kind: 'path'; locator: BoardAssetLocator; appliedRemapIds?: string[] };

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

export interface BoardStickyObject extends BoardObjectBase {
  type: 'sticky'; text: string; fontSize: number; color: string;
}
export interface BoardShapeObject extends BoardObjectBase {
  type: 'shape'; shape: 'rectangle' | 'ellipse' | 'diamond'; text: string; fontSize: number; color: string; borderColor: string; borderWidth: number;
}
export interface BoardLinkObject extends BoardObjectBase {
  type: 'link'; title: string; url: string; color: string;
}
export type BoardObject = BoardAssetObject | BoardTextObject | BoardFrameObject | BoardSmartFrameObject | BoardStickyObject | BoardShapeObject | BoardLinkObject;

export interface BoardConnection {
  id: string;
  type: 'manual';
  sourceObjectId: string;
  targetObjectId: string;
  width?: number;
  sourceSide: BoardSide;
  targetSide: BoardSide;
  label: string;
  color: string;
}

export interface BoardDocument {
  schemaVersion: 3;
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
