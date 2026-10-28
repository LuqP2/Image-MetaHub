export class BoardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BoardError';
    this.code = code;
  }
}

const fail = (message) => { throw new BoardError('BOARD_INVALID_DOCUMENT', message); };
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value, label, nonempty = false) => {
  if (typeof value !== 'string' || (nonempty && !value.trim())) fail(`${label} must be a ${nonempty ? 'non-empty ' : ''}string.`);
  return value;
};
const number = (value, label, minimum = -Infinity) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) fail(`${label} is invalid.`);
  return value;
};
const integer = (value, label) => {
  number(value, label, 0);
  if (!Number.isSafeInteger(value)) fail(`${label} must be a non-negative safe integer.`);
  return value;
};
export const isBoardId = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function validateBoardId(value) {
  if (!isBoardId(value)) fail('Board ID must be a UUID.');
  return value;
}
const color = (value) => {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('Color must be a six-digit hex color.');
  return value;
};
const side = (value) => {
  if (!['top', 'right', 'bottom', 'left'].includes(value)) fail('Invalid connection side.');
  return value;
};
const metadataFields = new Set(['model', 'loras', 'seed', 'dimensions', 'generator', 'rating', 'prompt']);

export function normalizeBoardLocator(value) {
  if (!record(value)) fail('Asset locator is required.');
  if (value.directoryPath !== null && typeof value.directoryPath !== 'string') fail('Invalid directory path.');
  const relativePath = string(value.relativePath, 'Relative path', true).replace(/\\/g, '/');
  if (/^(?:\/|[a-z]:)/i.test(relativePath) || relativePath.split('/').some(part => part === '..')) fail('Asset path must stay relative to its directory.');
  return {
    imageId: string(value.imageId, 'Image ID', true),
    directoryPath: value.directoryPath,
    relativePath,
  };
}

function normalizeStable(value) {
  const result = {};
  for (const key of ['assetId', 'revisionId', 'locationId', 'rootId']) result[key] = validateBoardId(value[key]);
  return result;
}

function normalizeReference(value) {
  if (!record(value) || !['stable', 'path'].includes(value.kind)) fail('Invalid asset reference.');
  if (value.appliedRemapIds !== undefined && (!Array.isArray(value.appliedRemapIds) || value.appliedRemapIds.some(id => typeof id !== 'string' || !id.trim()))) fail('Invalid applied remap IDs.');
  return {
    kind: value.kind,
    ...(value.kind === 'stable' ? normalizeStable(value) : {}),
    locator: normalizeBoardLocator(value.locator),
    appliedRemapIds: [...new Set(value.appliedRemapIds ?? [])],
  };
}

// Reconstruct explicitly: imported runtime data, handles and unknown fields never reach disk.
export function normalizeBoardDocument(input) {
  if (!record(input)) fail('Board document is required.');
  if (input.schemaVersion !== 1) throw new BoardError('BOARD_UNSUPPORTED_VERSION', 'Unsupported board version.');
  if (!Array.isArray(input.objects) || !Array.isArray(input.connections)) fail('Objects and connections must be arrays.');
  if (!record(input.viewport)) fail('Viewport is required.');
  const ids = new Set();
  const claim = (id) => {
    string(id, 'Object/connection ID', true);
    if (ids.has(id)) fail('Duplicate object or connection ID.');
    ids.add(id);
    return id;
  };
  const objects = input.objects.map(value => {
    if (!record(value) || !['asset', 'text', 'frame'].includes(value.type)) fail('Invalid board object.');
    const base = {
      id: claim(value.id), type: value.type,
      x: number(value.x, 'X'), y: number(value.y, 'Y'),
      width: number(value.width, 'Width', Number.MIN_VALUE),
      height: number(value.height, 'Height', Number.MIN_VALUE),
      zIndex: number(value.zIndex, 'Z index'),
      frameId: value.frameId === null ? null : string(value.frameId, 'Frame ID', true),
    };
    if (value.type === 'frame') {
      if (base.frameId !== null) fail('Nested frames are not supported.');
      return { ...base, title: string(value.title, 'Frame title'), color: color(value.color) };
    }
    if (value.type === 'text') return { ...base, text: string(value.text, 'Text'), fontSize: number(value.fontSize, 'Font size', 1), color: color(value.color) };
    if (!['image', 'video', 'audio', 'model3d'].includes(value.mediaType)) fail('Invalid media type.');
    if (!Array.isArray(value.visibleFields) || value.visibleFields.some(field => !metadataFields.has(field))) fail('Invalid visible metadata fields.');
    return { ...base, reference: normalizeReference(value.reference), name: string(value.name, 'Asset name'), mediaType: value.mediaType, visibleFields: [...new Set(value.visibleFields)] };
  });
  const byId = new Map(objects.map(object => [object.id, object]));
  for (const object of objects) {
    if (object.frameId !== null && byId.get(object.frameId)?.type !== 'frame') fail('Frame reference does not point to a frame.');
  }
  const connections = input.connections.map(value => {
    if (!record(value) || value.type !== 'manual') fail('Invalid connection.');
    if (!byId.has(value.sourceObjectId) || !byId.has(value.targetObjectId)) fail('Connection endpoint is missing.');
    return {
      id: claim(value.id), type: 'manual', sourceObjectId: value.sourceObjectId, targetObjectId: value.targetObjectId,
      sourceSide: side(value.sourceSide), targetSide: side(value.targetSide), label: string(value.label, 'Connection label'), color: color(value.color),
    };
  });
  const zoom = number(input.viewport.zoom, 'Zoom', 0.1);
  if (zoom > 4) fail('Zoom cannot exceed 4.');
  return {
    schemaVersion: 1, id: validateBoardId(input.id), revision: integer(input.revision, 'Revision'), name: string(input.name, 'Board name', true),
    createdAt: integer(input.createdAt, 'Creation time'), updatedAt: integer(input.updatedAt, 'Update time'),
    viewport: { x: number(input.viewport.x, 'Viewport X'), y: number(input.viewport.y, 'Viewport Y'), zoom }, objects, connections,
  };
}

export function createBoardDocument(name = 'Untitled board', id = crypto.randomUUID(), now = Date.now()) {
  return normalizeBoardDocument({ schemaVersion: 1, id, revision: 0, name, createdAt: now, updatedAt: now, viewport: { x: 0, y: 0, zoom: 1 }, objects: [], connections: [] });
}

export function duplicateBoardDocument(document, name = `${document.name} (copy)`, id = crypto.randomUUID(), now = Date.now()) {
  return normalizeBoardDocument({ ...document, id, name, revision: 0, createdAt: now, updatedAt: now });
}

export function summarizeBoard(document) {
  const { id, name, revision, createdAt, updatedAt } = document;
  return { id, name, revision, createdAt, updatedAt, objectCount: document.objects.length };
}

export function normalizeReferenceRemap(value) {
  if (!record(value)) fail('Invalid reference remap.');
  return {
    operationId: string(value.operationId, 'Operation ID', true),
    oldLocator: normalizeBoardLocator(value.oldLocator), newLocator: normalizeBoardLocator(value.newLocator),
    ...(value.stableReference ? { stableReference: normalizeStable(value.stableReference) } : {}),
  };
}

const sameLocator = (a, b) => a.imageId === b.imageId && a.directoryPath === b.directoryPath && a.relativePath === b.relativePath;

export function applyBoardReferenceRemaps(document, remaps) {
  const normalized = remaps.map(normalizeReferenceRemap);
  return normalizeBoardDocument({ ...document, objects: document.objects.map(object => {
    if (object.type !== 'asset') return object;
    let reference = object.reference;
    const observed = new Set(reference.appliedRemapIds ?? []);
    // Track operations per reference, including non-matches: reused filenames must
    // not make an old operation match a reference that has already observed it.
    for (const remap of normalized) {
      if (observed.has(remap.operationId)) continue;
      const stableMatch = reference.kind === 'stable' && remap.stableReference
        && reference.assetId === remap.stableReference.assetId
        && reference.locationId === remap.stableReference.locationId;
      const locatorMatch = sameLocator(reference.locator, remap.oldLocator)
        && !(reference.kind === 'stable' && remap.stableReference && reference.assetId !== remap.stableReference.assetId);
      if (stableMatch || locatorMatch) {
        reference = { ...reference, ...(remap.stableReference && reference.kind === 'stable' ? remap.stableReference : {}), locator: remap.newLocator };
      }
      observed.add(remap.operationId);
    }
    return { ...object, reference: { ...reference, appliedRemapIds: [...observed] } };
  }) });
}

export function mergeReferenceRemaps(existing, additions) {
  const result = existing.map(normalizeReferenceRemap);
  const byId = new Map(result.map(value => [value.operationId, JSON.stringify(value)]));
  for (const input of additions) {
    const value = normalizeReferenceRemap(input);
    const previous = byId.get(value.operationId);
    if (previous && previous !== JSON.stringify(value)) throw new BoardError('BOARD_REMAP_CONFLICT', 'Operation ID was already used for a different remap.');
    if (!previous) { result.push(value); byId.set(value.operationId, JSON.stringify(value)); }
  }
  return result;
}
