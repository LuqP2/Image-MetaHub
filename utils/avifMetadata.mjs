// @ts-check

import { parse as parseExif, sidecar as parseSidecar } from 'exifr/dist/full.esm.mjs';

export const AVIF_MIME_TYPE = 'image/avif';
export const COMFYUI_XMP_NAMESPACE = 'https://github.com/Comfy-Org/ComfyUI';
export const PIXELMETA_XMP_NAMESPACE = 'https://ai-foundry.dev/ns/pixelmeta/1.0/';
export const IMAGE_METAHUB_XMP_NAMESPACE = 'https://github.com/LuqP2/Image-MetaHub';

const XMP_CONTENT_TYPE = 'application/rdf+xml';
const MAX_METADATA_ITEM_BYTES = 32 * 1024 * 1024;
const IMAGE_METAHUB_BLOCK_START = '<!-- Image MetaHub metadata -->';
const IMAGE_METAHUB_BLOCK_END = '<!-- /Image MetaHub metadata -->';
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** @typedef {{ start: number, end: number, contentStart: number, contentEnd: number, type: string, truncated: boolean, openEnded: boolean }} BoxRange */
/** @typedef {{ position: number, width: number, value: number }} IntegerField */
/** @typedef {{ offset: IntegerField, length: IntegerField }} ItemExtent */
/** @typedef {{ id: number, constructionMethod: number, dataReferenceIndex: number, baseOffset: IntegerField, extents: ItemExtent[] }} ItemLocation */
/** @typedef {{ id: number, type: string, contentType?: string }} ItemInfo */
/** @typedef {{ bytes: Uint8Array, view: DataView, itemInfos: ItemInfo[], itemLocations: ItemLocation[], dimensions: { width: number, height: number } | null, metadataTruncated: boolean, openEndedTopLevelBox: boolean }} AvifContainer */
/** @typedef {{ field: 'prompt' | 'workflow', canonicalSource: string, conflictingSource: string }} CarrierConflict */
/** @typedef {{ field: 'prompt' | 'workflow', value: string, source: string, priority: number }} DocumentCandidate */

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

/**
 * @param {ArrayBuffer | ArrayBufferView} input
 * @returns {Uint8Array}
 */
function toBytes(input) {
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  // Vitest/jsdom and Electron can pass binary objects across JavaScript realms,
  // where `instanceof` and `ArrayBuffer.isView` no longer recognize the value.
  if (input && typeof input === 'object') {
    const candidate = /** @type {{ buffer?: ArrayBufferLike, byteOffset?: number, byteLength?: number }} */ (input);
    if (candidate.buffer && typeof candidate.byteLength === 'number') {
      return new Uint8Array(candidate.buffer, candidate.byteOffset ?? 0, candidate.byteLength);
    }
    if (typeof candidate.byteLength === 'number') {
      return new Uint8Array(/** @type {ArrayBuffer} */ (input));
    }
  }
  throw new TypeError('Expected an ArrayBuffer or ArrayBufferView.');
}

/**
 * @param {Uint8Array} bytes
 * @returns {DataView}
 */
function createView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * @param {DataView} view
 * @param {number} offset
 * @returns {string}
 */
function readType(view, offset) {
  if (offset < 0 || offset + 4 > view.byteLength) {
    return '';
  }
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * @param {DataView} view
 * @param {number} offset
 * @param {number} limit
 * @returns {BoxRange | null}
 */
function readBox(view, offset, limit) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 8 > limit || limit > view.byteLength) {
    return null;
  }

  const size32 = view.getUint32(offset);
  const type = readType(view, offset + 4);
  let headerSize = 8;
  let size = size32;
  let openEnded = false;

  if (size32 === 1) {
    if (offset + 16 > limit) {
      return null;
    }
    const size64 = view.getBigUint64(offset + 8);
    if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    size = Number(size64);
    headerSize = 16;
  } else if (size32 === 0) {
    size = limit - offset;
    openEnded = true;
  }

  if (size < headerSize || !Number.isSafeInteger(size)) {
    return null;
  }

  const declaredEnd = offset + size;
  if (!Number.isSafeInteger(declaredEnd) || declaredEnd < offset) {
    return null;
  }
  const end = Math.min(declaredEnd, limit);
  return {
    start: offset,
    end,
    contentStart: offset + headerSize,
    contentEnd: end,
    type,
    truncated: declaredEnd > limit,
    openEnded,
  };
}

/**
 * @param {DataView} view
 * @param {number} start
 * @param {number} end
 * @returns {BoxRange[]}
 */
function listBoxes(view, start, end) {
  /** @type {BoxRange[]} */
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    const box = readBox(view, offset, end);
    if (!box) {
      break;
    }
    boxes.push(box);
    if (box.openEnded || box.end <= offset) {
      break;
    }
    offset = box.end;
  }
  return boxes;
}

/**
 * @param {DataView} view
 * @param {number} offset
 * @param {number} end
 * @returns {{ value: string, nextOffset: number }}
 */
function readNullTerminatedString(view, offset, end) {
  const start = offset;
  while (offset < end && view.getUint8(offset) !== 0) {
    offset += 1;
  }
  const value = textDecoder.decode(
    new Uint8Array(view.buffer, view.byteOffset + start, Math.max(0, offset - start)),
  );
  return { value, nextOffset: offset < end ? offset + 1 : end };
}

/**
 * @param {DataView} view
 * @param {BoxRange} itemInfoBox
 * @returns {ItemInfo[]}
 */
function parseItemInfo(view, itemInfoBox) {
  if (itemInfoBox.contentStart + 6 > itemInfoBox.contentEnd) {
    return [];
  }
  const version = view.getUint8(itemInfoBox.contentStart);
  let offset = itemInfoBox.contentStart + 4;
  const entryCount = version === 0 ? view.getUint16(offset) : view.getUint32(offset);
  offset += version === 0 ? 2 : 4;

  /** @type {ItemInfo[]} */
  const entries = [];
  for (let entryIndex = 0; entryIndex < entryCount && offset + 8 <= itemInfoBox.contentEnd; entryIndex += 1) {
    const entryBox = readBox(view, offset, itemInfoBox.contentEnd);
    if (!entryBox || entryBox.truncated) {
      break;
    }
    offset = entryBox.end;
    if (entryBox.type !== 'infe' || entryBox.contentStart + 12 > entryBox.contentEnd) {
      continue;
    }

    const entryVersion = view.getUint8(entryBox.contentStart);
    if (entryVersion < 2 || entryVersion > 3) {
      continue;
    }
    let entryOffset = entryBox.contentStart + 4;
    const id = entryVersion === 2 ? view.getUint16(entryOffset) : view.getUint32(entryOffset);
    entryOffset += entryVersion === 2 ? 2 : 4;
    entryOffset += 2;
    if (entryOffset + 4 > entryBox.contentEnd) {
      continue;
    }
    const type = readType(view, entryOffset);
    entryOffset += 4;
    const itemName = readNullTerminatedString(view, entryOffset, entryBox.contentEnd);
    entryOffset = itemName.nextOffset;
    const contentType = type === 'mime'
      ? readNullTerminatedString(view, entryOffset, entryBox.contentEnd).value
      : undefined;
    entries.push({ id, type, contentType });
  }
  return entries;
}

/**
 * @param {DataView} view
 * @param {number} position
 * @param {number} width
 * @param {number} end
 * @returns {IntegerField}
 */
function readSizedInteger(view, position, width, end) {
  if (width === 0) {
    return { position, width, value: 0 };
  }
  if ((width !== 4 && width !== 8) || position + width > end) {
    throw new Error(`Unsupported or truncated iloc integer width: ${width}.`);
  }
  if (width === 4) {
    return { position, width, value: view.getUint32(position) };
  }
  const value = view.getBigUint64(position);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('AVIF iloc integer exceeds the JavaScript safe integer range.');
  }
  return { position, width, value: Number(value) };
}

/**
 * @param {DataView} view
 * @param {BoxRange} itemLocationBox
 * @returns {ItemLocation[]}
 */
function parseItemLocations(view, itemLocationBox) {
  if (itemLocationBox.contentStart + 8 > itemLocationBox.contentEnd) {
    return [];
  }
  const version = view.getUint8(itemLocationBox.contentStart);
  if (version > 2) {
    return [];
  }
  let offset = itemLocationBox.contentStart + 4;
  const sizeByte = view.getUint8(offset);
  const offsetWidth = (sizeByte >> 4) & 0x0f;
  const lengthWidth = sizeByte & 0x0f;
  offset += 1;
  const secondSizeByte = view.getUint8(offset);
  const baseOffsetWidth = (secondSizeByte >> 4) & 0x0f;
  const indexWidth = version === 1 || version === 2 ? secondSizeByte & 0x0f : 0;
  offset += 1;
  const itemCount = version < 2 ? view.getUint16(offset) : view.getUint32(offset);
  offset += version < 2 ? 2 : 4;

  /** @type {ItemLocation[]} */
  const items = [];
  for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
    const idWidth = version < 2 ? 2 : 4;
    if (offset + idWidth > itemLocationBox.contentEnd) {
      throw new Error('Truncated AVIF iloc item identifier.');
    }
    const id = idWidth === 2 ? view.getUint16(offset) : view.getUint32(offset);
    offset += idWidth;
    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      if (offset + 2 > itemLocationBox.contentEnd) {
        throw new Error('Truncated AVIF iloc construction method.');
      }
      constructionMethod = view.getUint16(offset) & 0x000f;
      offset += 2;
    }
    if (offset + 2 > itemLocationBox.contentEnd) {
      throw new Error('Truncated AVIF iloc data reference.');
    }
    const dataReferenceIndex = view.getUint16(offset);
    offset += 2;
    const baseOffset = readSizedInteger(view, offset, baseOffsetWidth, itemLocationBox.contentEnd);
    offset += baseOffsetWidth;
    if (offset + 2 > itemLocationBox.contentEnd) {
      throw new Error('Truncated AVIF iloc extent count.');
    }
    const extentCount = view.getUint16(offset);
    offset += 2;

    /** @type {ItemExtent[]} */
    const extents = [];
    for (let extentIndex = 0; extentIndex < extentCount; extentIndex += 1) {
      if (indexWidth > 0) {
        readSizedInteger(view, offset, indexWidth, itemLocationBox.contentEnd);
        offset += indexWidth;
      }
      const extentOffset = readSizedInteger(view, offset, offsetWidth, itemLocationBox.contentEnd);
      offset += offsetWidth;
      const extentLength = readSizedInteger(view, offset, lengthWidth, itemLocationBox.contentEnd);
      offset += lengthWidth;
      extents.push({ offset: extentOffset, length: extentLength });
    }
    items.push({ id, constructionMethod, dataReferenceIndex, baseOffset, extents });
  }
  return items;
}

/**
 * @param {DataView} view
 * @param {BoxRange} metaBox
 * @returns {{ width: number, height: number } | null}
 */
function parseSpatialExtents(view, metaBox) {
  const metaChildren = listBoxes(view, metaBox.contentStart + 4, metaBox.contentEnd);
  const itemProperties = metaChildren.find((boxRange) => boxRange.type === 'iprp');
  if (!itemProperties) {
    return null;
  }
  const propertyContainers = listBoxes(view, itemProperties.contentStart, itemProperties.contentEnd);
  const propertyContainer = propertyContainers.find((boxRange) => boxRange.type === 'ipco');
  if (!propertyContainer) {
    return null;
  }
  const properties = listBoxes(view, propertyContainer.contentStart, propertyContainer.contentEnd);
  const spatialExtents = properties.find((boxRange) => boxRange.type === 'ispe');
  if (!spatialExtents || spatialExtents.contentStart + 12 > spatialExtents.contentEnd) {
    return null;
  }
  const width = view.getUint32(spatialExtents.contentStart + 4);
  const height = view.getUint32(spatialExtents.contentStart + 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * @param {ArrayBuffer | ArrayBufferView} input
 * @returns {boolean}
 */
export function isAvifBuffer(input) {
  const bytes = toBytes(input);
  if (bytes.byteLength < 16) {
    return false;
  }
  const view = createView(bytes);
  const firstBox = readBox(view, 0, view.byteLength);
  if (!firstBox || firstBox.type !== 'ftyp' || firstBox.contentStart + 8 > firstBox.contentEnd) {
    return false;
  }
  const brands = [readType(view, firstBox.contentStart)];
  for (let offset = firstBox.contentStart + 8; offset + 4 <= firstBox.contentEnd; offset += 4) {
    brands.push(readType(view, offset));
  }
  return brands.some((brand) => AVIF_BRANDS.has(brand));
}

/**
 * @param {ArrayBuffer | ArrayBufferView} input
 * @returns {AvifContainer}
 */
function inspectContainer(input) {
  const bytes = toBytes(input);
  const view = createView(bytes);
  if (!isAvifBuffer(bytes)) {
    throw new Error('AVIF file type box is missing an AVIF brand.');
  }

  const topLevelBoxes = listBoxes(view, 0, view.byteLength);
  const metaBox = topLevelBoxes.find((boxRange) => boxRange.type === 'meta');
  if (!metaBox || metaBox.contentStart + 4 > metaBox.contentEnd) {
    return {
      bytes,
      view,
      itemInfos: [],
      itemLocations: [],
      dimensions: null,
      metadataTruncated: Boolean(metaBox?.truncated) || topLevelBoxes.some((boxRange) => boxRange.truncated),
      openEndedTopLevelBox: topLevelBoxes.some((boxRange) => boxRange.openEnded),
    };
  }

  const metaChildren = listBoxes(view, metaBox.contentStart + 4, metaBox.contentEnd);
  const itemInfoBox = metaChildren.find((boxRange) => boxRange.type === 'iinf');
  const itemLocationBox = metaChildren.find((boxRange) => boxRange.type === 'iloc');
  const itemInfos = itemInfoBox ? parseItemInfo(view, itemInfoBox) : [];
  const itemLocations = itemLocationBox ? parseItemLocations(view, itemLocationBox) : [];
  return {
    bytes,
    view,
    itemInfos,
    itemLocations,
    dimensions: parseSpatialExtents(view, metaBox),
    metadataTruncated: metaBox.truncated || metaChildren.some((boxRange) => boxRange.truncated),
    openEndedTopLevelBox: topLevelBoxes.some((boxRange) => boxRange.openEnded),
  };
}

/**
 * @param {ArrayBuffer | ArrayBufferView} input
 * @returns {{ width: number, height: number } | null}
 */
export function getAvifDimensions(input) {
  try {
    return inspectContainer(input).dimensions;
  } catch {
    return null;
  }
}

/**
 * @param {AvifContainer} container
 * @param {ItemInfo} itemInfo
 * @returns {{ data: Uint8Array | null, truncated: boolean, tooLarge: boolean }}
 */
function readItemData(container, itemInfo) {
  const location = container.itemLocations.find((candidate) => candidate.id === itemInfo.id);
  if (!location || location.extents.length === 0) {
    return { data: null, truncated: false, tooLarge: false };
  }
  if (location.constructionMethod !== 0 || location.dataReferenceIndex !== 0) {
    return { data: null, truncated: false, tooLarge: false };
  }

  /** @type {{ offset: number, length: number }[]} */
  const ranges = [];
  let totalLength = 0;
  for (const extent of location.extents) {
    const sourceOffset = location.baseOffset.value + extent.offset.value;
    const sourceEnd = sourceOffset + extent.length.value;
    totalLength += extent.length.value;
    if (
      !Number.isSafeInteger(sourceOffset) ||
      !Number.isSafeInteger(sourceEnd) ||
      !Number.isSafeInteger(totalLength) ||
      sourceOffset < 0 ||
      sourceEnd < sourceOffset
    ) {
      return { data: null, truncated: false, tooLarge: false };
    }
    if (totalLength > MAX_METADATA_ITEM_BYTES) {
      return { data: null, truncated: false, tooLarge: true };
    }
    if (sourceEnd > container.bytes.byteLength) {
      return { data: null, truncated: true, tooLarge: false };
    }
    ranges.push({ offset: sourceOffset, length: extent.length.value });
  }
  if (totalLength === 0) {
    return { data: null, truncated: false, tooLarge: false };
  }

  const data = new Uint8Array(totalLength);
  let destinationOffset = 0;
  for (const range of ranges) {
    data.set(container.bytes.subarray(range.offset, range.offset + range.length), destinationOffset);
    destinationOffset += range.length;
  }
  return { data, truncated: false, tooLarge: false };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * exifr intentionally returns raw XMP text values. Decode the five XML named
 * entities and numeric character references before interpreting JSON fields.
 *
 * @param {string} value
 * @returns {string}
 */
function decodeXmlEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (entity, reference) => {
    const normalized = reference.toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'apos') return "'";
    if (normalized === 'gt') return '>';
    if (normalized === 'lt') return '<';
    if (normalized === 'quot') return '"';
    const codePoint = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function documentString(value) {
  if (typeof value === 'string' && value.trim()) {
    return decodeXmlEntities(value.trim());
  }
  if (isRecord(value) || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return null;
}

/**
 * @param {string} value
 * @returns {unknown}
 */
function parseJson(value) {
  try {
    return JSON.parse(value.replace(/:\s*NaN/g, ': null'));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * @param {string} left
 * @param {unknown} right
 * @returns {boolean}
 */
function documentsEqual(left, right) {
  const leftParsed = parseJson(left);
  const rightParsed = typeof right === 'string' ? parseJson(right) : right;
  if (leftParsed === null || rightParsed === null || rightParsed === undefined) {
    return false;
  }
  return stableJson(leftParsed) === stableJson(rightParsed);
}

/**
 * @param {string | undefined} namespace
 * @returns {number}
 */
function namespacePriority(namespace) {
  if (namespace === COMFYUI_XMP_NAMESPACE) return 300;
  if (namespace === PIXELMETA_XMP_NAMESPACE) return 200;
  if (namespace === IMAGE_METAHUB_XMP_NAMESPACE) return 150;
  return 100;
}

/**
 * @param {Uint8Array} data
 * @param {number} packetIndex
 * @returns {Promise<{ candidates: DocumentCandidate[], metaHubData?: unknown, extension?: unknown, parameters?: string, namespaces: string[] }>}
 */
async function parseXmpPacket(data, packetIndex) {
  const parsed = await parseSidecar(data, {
    xmp: true,
    mergeOutput: true,
    sanitize: false,
    reviveValues: false,
  }, 'xmp').catch(() => null);
  if (!isRecord(parsed)) {
    return { candidates: [], namespaces: [] };
  }

  const namespaceMap = isRecord(parsed.xmlns) ? parsed.xmlns : {};
  const namespaces = Object.values(namespaceMap).filter((value) => typeof value === 'string');
  /** @type {DocumentCandidate[]} */
  const candidates = [];
  let metaHubData;
  let extension;
  let parameters;

  for (const [prefix, namespaceValue] of Object.entries(namespaceMap)) {
    const namespace = typeof namespaceValue === 'string' ? namespaceValue : undefined;
    const values = parsed[prefix];
    if (!isRecord(values)) {
      continue;
    }
    for (const [rawKey, rawValue] of Object.entries(values)) {
      const key = rawKey.slice(rawKey.lastIndexOf(':') + 1).toLowerCase();
      const value = documentString(rawValue);
      if ((key === 'prompt' || key === 'workflow') && value) {
        candidates.push({
          field: key,
          value,
          source: `xmp.${prefix || 'default'}.${key}[${packetIndex}]`,
          priority: namespacePriority(namespace),
        });
      } else if (key === 'imagemetahub_data' && namespace === PIXELMETA_XMP_NAMESPACE && value) {
        metaHubData = parseJson(value) ?? undefined;
      } else if (key === 'data' && namespace === IMAGE_METAHUB_XMP_NAMESPACE && value) {
        extension = parseJson(value) ?? undefined;
      } else if (key === 'parameters' && namespace === IMAGE_METAHUB_XMP_NAMESPACE && value) {
        parameters = value;
      }
    }
  }
  return { candidates, metaHubData, extension, parameters, namespaces };
}

/**
 * @param {ArrayBuffer | ArrayBufferView} input
 * @returns {Promise<{ rawMetadata: (Record<string, unknown> & { _carrierFormat: 'avif' }) | null, dimensions: { width: number, height: number } | null, metadataTruncated: boolean, xmpNamespaces: string[], errors: string[] }>}
 */
export async function parseAvifMetadata(input) {
  /** @type {string[]} */
  const errors = [];
  let container;
  try {
    container = inspectContainer(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      rawMetadata: null,
      dimensions: null,
      metadataTruncated: /truncat/i.test(message),
      xmpNamespaces: [],
      errors: [message],
    };
  }

  /** @type {DocumentCandidate[]} */
  const candidates = [];
  /** @type {string[]} */
  const xmpNamespaces = [];
  let metaHubData;
  let extension;
  let parameters;
  let metadataTruncated = container.metadataTruncated;

  const xmpItems = container.itemInfos.filter(
    (itemInfo) => itemInfo.type === 'mime' && itemInfo.contentType === XMP_CONTENT_TYPE,
  );
  for (let packetIndex = 0; packetIndex < xmpItems.length; packetIndex += 1) {
    const item = readItemData(container, xmpItems[packetIndex]);
    metadataTruncated ||= item.truncated;
    if (item.tooLarge) {
      errors.push(`AVIF XMP item exceeds the ${MAX_METADATA_ITEM_BYTES}-byte safety limit.`);
      continue;
    }
    if (!item.data) {
      continue;
    }
    const parsedPacket = await parseXmpPacket(item.data, packetIndex);
    candidates.push(...parsedPacket.candidates);
    xmpNamespaces.push(...parsedPacket.namespaces);
    metaHubData ??= parsedPacket.metaHubData;
    extension ??= parsedPacket.extension;
    parameters ??= parsedPacket.parameters;
  }

  const exifItems = container.itemInfos.filter((itemInfo) => itemInfo.type === 'Exif');
  if (exifItems.length > 0) {
    for (const itemInfo of exifItems) {
      const item = readItemData(container, itemInfo);
      metadataTruncated ||= item.truncated;
      if (item.tooLarge) {
        errors.push(`AVIF EXIF item exceeds the ${MAX_METADATA_ITEM_BYTES}-byte safety limit.`);
      }
    }
    if (!metadataTruncated) {
      const exifData = await parseExif(toBytes(input), {
        tiff: true,
        userComment: true,
        xmp: false,
        mergeOutput: true,
        sanitize: false,
        reviveValues: false,
      }).catch(() => null);
      if (isRecord(exifData)) {
        for (const [key, rawValue] of Object.entries(exifData)) {
          let value = rawValue;
          if (value instanceof Uint8Array) {
            value = textDecoder.decode(value).replaceAll('\0', '').trim();
          }
          if (typeof value !== 'string') {
            continue;
          }
          const normalizedKey = key.toLowerCase().replaceAll(' ', '');
          if (normalizedKey === 'usercomment') {
            const userComment = parseJson(value);
            if (isRecord(userComment)) {
              for (const field of ['prompt', 'workflow']) {
                const document = documentString(userComment[field]);
                if (document) {
                  candidates.push({
                    field: /** @type {'prompt' | 'workflow'} */ (field),
                    value: document,
                    source: `exif.${key}`,
                    priority: 50,
                  });
                }
              }
            }
          }
          const colonIndex = value.indexOf(':');
          if (colonIndex > 0) {
            const field = value.slice(0, colonIndex).trim().toLowerCase();
            const document = value.slice(colonIndex + 1).trim();
            if ((field === 'prompt' || field === 'workflow') && document) {
              candidates.push({
                field,
                value: document,
                source: `exif.${key}`,
                priority: 50,
              });
            }
          }
        }
      }
    }
  }

  /** @type {Record<string, unknown> & { _carrierFormat: 'avif' }} */
  const rawMetadata = { _carrierFormat: 'avif' };
  /** @type {CarrierConflict[]} */
  const conflicts = [];
  for (const field of /** @type {const} */ (['prompt', 'workflow'])) {
    const fieldCandidates = candidates
      .filter((candidate) => candidate.field === field)
      .sort((left, right) => right.priority - left.priority);
    const canonical = fieldCandidates[0];
    if (canonical) {
      rawMetadata[field] = canonical.value;
      for (const candidate of fieldCandidates.slice(1)) {
        if (!documentsEqual(canonical.value, candidate.value)) {
          conflicts.push({
            field,
            canonicalSource: canonical.source,
            conflictingSource: candidate.source,
          });
        }
      }
    }
  }

  if (isRecord(metaHubData)) {
    rawMetadata.imagemetahub_data = metaHubData;
    const nestedDocuments = {
      prompt: metaHubData.prompt_api,
      workflow: metaHubData.workflow,
    };
    for (const field of /** @type {const} */ (['prompt', 'workflow'])) {
      const nestedDocument = nestedDocuments[field];
      const canonicalDocument = typeof rawMetadata[field] === 'string' ? rawMetadata[field] : null;
      if (canonicalDocument && nestedDocument !== undefined && !documentsEqual(canonicalDocument, nestedDocument)) {
        conflicts.push({
          field,
          canonicalSource: `xmp.${field}`,
          conflictingSource: `imagemetahub_data.${field === 'prompt' ? 'prompt_api' : 'workflow'}`,
        });
      } else if (!canonicalDocument) {
        const legacyDocument = documentString(nestedDocument);
        if (legacyDocument) {
          rawMetadata[field] = legacyDocument;
        }
      }
    }
  }
  if (isRecord(extension)) {
    rawMetadata.imagemetahub_extension = extension;
  }
  if (parameters) {
    rawMetadata.parameters = parameters;
  }
  if (conflicts.length > 0) {
    const uniqueConflicts = new Map(conflicts.map((conflict) => [
      `${conflict.field}:${conflict.canonicalSource}:${conflict.conflictingSource}`,
      conflict,
    ]));
    rawMetadata._carrierConflicts = Array.from(uniqueConflicts.values());
  }

  return {
    rawMetadata: Object.keys(rawMetadata).length > 1 ? rawMetadata : null,
    dimensions: container.dimensions,
    metadataTruncated,
    xmpNamespaces: Array.from(new Set(xmpNamespaces)),
    errors,
  };
}

/**
 * @param {DataView} view
 * @param {IntegerField} field
 * @param {number} value
 */
function writeSizedInteger(view, field, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('AVIF item location value is outside the safe integer range.');
  }
  if (field.width === 4) {
    if (value > 0xffffffff) {
      throw new Error('AVIF item location does not fit in its four-byte field.');
    }
    view.setUint32(field.position, value);
    return;
  }
  if (field.width === 8) {
    view.setBigUint64(field.position, BigInt(value));
    return;
  }
  if (field.width === 0 && value === 0) {
    return;
  }
  throw new Error('AVIF item location cannot be rewritten with a zero-width field.');
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeXmlText(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * @param {string} xmp
 * @param {Record<string, unknown>} extension
 * @returns {string}
 */
function updateImageMetaHubXmp(xmp, extension) {
  const existingBlock = new RegExp(
    `\\s*${IMAGE_METAHUB_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${IMAGE_METAHUB_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'g',
  );
  const withoutExistingBlock = xmp.replace(existingBlock, '');
  const rdfOpeningTag = withoutExistingBlock.match(/<([A-Za-z_][\w.-]*:)?RDF\b[^>]*>/i);
  const rdfPrefix = rdfOpeningTag?.[1] ?? '';
  const rdfClosingTag = new RegExp(`</${rdfPrefix.replace(':', '\\:')}RDF\\s*>`, 'i');
  const closingMatch = rdfClosingTag.exec(withoutExistingBlock);
  if (!closingMatch || closingMatch.index < 0) {
    throw new Error('AVIF XMP packet does not contain a writable RDF document.');
  }

  const descriptionTag = `${rdfPrefix}Description`;
  const aboutAttribute = `${rdfPrefix}about`;
  const payload = JSON.stringify(extension);
  const lines = [
    `  ${IMAGE_METAHUB_BLOCK_START}`,
    `  <${descriptionTag} ${aboutAttribute}="" xmlns:imh="${IMAGE_METAHUB_XMP_NAMESPACE}">`,
    `    <imh:data>${escapeXmlText(payload)}</imh:data>`,
  ];
  lines.push(`  </${descriptionTag}>`, `  ${IMAGE_METAHUB_BLOCK_END}`);
  const block = `${lines.join('\n')}\n`;
  return `${withoutExistingBlock.slice(0, closingMatch.index)}${block}${withoutExistingBlock.slice(closingMatch.index)}`;
}

/**
 * @param {DataView} view
 * @param {ItemLocation} location
 * @param {number} payloadOffset
 * @param {number} payloadLength
 */
function pointItemAtPayload(view, location, payloadOffset, payloadLength) {
  if (location.constructionMethod !== 0 || location.dataReferenceIndex !== 0 || location.extents.length === 0) {
    throw new Error('AVIF XMP item uses an unsupported location method.');
  }
  const firstExtent = location.extents[0];
  if (location.baseOffset.width > 0) {
    writeSizedInteger(view, location.baseOffset, payloadOffset);
    writeSizedInteger(view, firstExtent.offset, 0);
  } else {
    writeSizedInteger(view, firstExtent.offset, payloadOffset);
  }
  writeSizedInteger(view, firstExtent.length, payloadLength);
  for (const extent of location.extents.slice(1)) {
    writeSizedInteger(view, extent.offset, 0);
    writeSizedInteger(view, extent.length, 0);
  }
}

/**
 * @param {ItemLocation} location
 * @returns {{ start: number, end: number }[] | null}
 */
function getDirectItemRanges(location) {
  if (location.constructionMethod !== 0 || location.dataReferenceIndex !== 0) return null;
  const ranges = [];
  for (const extent of location.extents) {
    const start = location.baseOffset.value + extent.offset.value;
    const end = start + extent.length.value;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      return null;
    }
    if (end > start) ranges.push({ start, end });
  }
  return ranges;
}

/**
 * @param {{ start: number, end: number }[]} leftRanges
 * @param {{ start: number, end: number }[]} rightRanges
 * @returns {boolean}
 */
function rangesOverlap(leftRanges, rightRanges) {
  return leftRanges.some((left) => rightRanges.some((right) => (
    left.start < right.end && right.start < left.end
  )));
}

/**
 * @param {AvifContainer} container
 * @param {ItemLocation} target
 * @param {Set<number>} ignoredItemIds
 * @returns {boolean}
 */
function itemPayloadOverlapsAnotherItem(container, target, ignoredItemIds = new Set()) {
  const targetRanges = getDirectItemRanges(target);
  if (!targetRanges) return true;
  return container.itemLocations.some((candidate) => {
    if (candidate.id === target.id || ignoredItemIds.has(candidate.id)) return false;
    const candidateRanges = getDirectItemRanges(candidate);
    return candidateRanges ? rangesOverlap(targetRanges, candidateRanges) : false;
  });
}

/**
 * Reuse the current item extents when the replacement fits. This keeps repeated
 * metadata edits from growing an AVIF by another `mdat` box every time.
 *
 * @param {AvifContainer} container
 * @param {ItemLocation} location
 * @param {Uint8Array} payload
 * @returns {ArrayBuffer | null}
 */
function overwriteItemDataWhenItFits(container, location, payload) {
  if (location.constructionMethod !== 0 || location.dataReferenceIndex !== 0) return null;
  if (itemPayloadOverlapsAnotherItem(container, location)) return null;
  const capacity = location.extents.reduce((total, extent) => total + extent.length.value, 0);
  if (!Number.isSafeInteger(capacity) || payload.byteLength > capacity) return null;

  const output = new Uint8Array(container.bytes);
  const outputView = createView(output);
  let payloadOffset = 0;
  for (const extent of location.extents) {
    const extentStart = location.baseOffset.value + extent.offset.value;
    const extentEnd = extentStart + extent.length.value;
    if (extentStart < 0 || extentEnd > output.byteLength || extentEnd < extentStart) return null;

    output.fill(0, extentStart, extentEnd);
    const writeLength = Math.min(extent.length.value, payload.byteLength - payloadOffset);
    if (writeLength > 0) {
      output.set(payload.subarray(payloadOffset, payloadOffset + writeLength), extentStart);
      payloadOffset += writeLength;
    }
    writeSizedInteger(outputView, extent.length, writeLength);
  }
  return output.buffer;
}

/**
 * Rewrite the one standard AVIF XMP item by appending a new `mdat` payload and
 * repointing its `iloc` entry. Encoded AV1 data and unrelated XMP text are not
 * reserialized.
 *
 * @param {ArrayBuffer | ArrayBufferView} input
 * @param {{ extension: Record<string, unknown> }} update
 * @returns {ArrayBuffer}
 */
export function rewriteAvifMetadata(input, update) {
  const container = inspectContainer(input);
  if (container.openEndedTopLevelBox) {
    throw new Error('AVIF files with an open-ended top-level box cannot be safely extended.');
  }
  const xmpItems = container.itemInfos.filter(
    (itemInfo) => itemInfo.type === 'mime' && itemInfo.contentType === XMP_CONTENT_TYPE,
  );
  if (xmpItems.length !== 1) {
    throw new Error(`Expected exactly one writable AVIF XMP item, found ${xmpItems.length}.`);
  }
  const xmpItem = xmpItems[0];
  const current = readItemData(container, xmpItem);
  if (!current.data || current.truncated || current.tooLarge) {
    throw new Error('AVIF XMP item is missing, truncated, or too large to rewrite safely.');
  }
  const currentXmp = textDecoder.decode(current.data);
  const nextXmp = textEncoder.encode(updateImageMetaHubXmp(currentXmp, update.extension));
  if (nextXmp.byteLength > MAX_METADATA_ITEM_BYTES) {
    throw new Error(`AVIF XMP item exceeds the ${MAX_METADATA_ITEM_BYTES}-byte safety limit.`);
  }

  const location = container.itemLocations.find((candidate) => candidate.id === xmpItem.id);
  if (!location) {
    throw new Error('AVIF XMP item location is missing.');
  }
  const inPlaceResult = overwriteItemDataWhenItFits(container, location, nextXmp);
  if (inPlaceResult) return inPlaceResult;

  const mediaDataSize = nextXmp.byteLength + 8;
  if (mediaDataSize > 0xffffffff) {
    throw new Error('AVIF XMP update is too large for a standard mdat box.');
  }
  const output = new Uint8Array(container.bytes.byteLength + mediaDataSize);
  output.set(container.bytes, 0);
  const outputView = createView(output);
  outputView.setUint32(container.bytes.byteLength, mediaDataSize);
  output.set(textEncoder.encode('mdat'), container.bytes.byteLength + 4);
  output.set(nextXmp, container.bytes.byteLength + 8);

  pointItemAtPayload(outputView, location, container.bytes.byteLength + 8, nextXmp.byteLength);
  return output.buffer;
}

/**
 * @param {ArrayBuffer | ArrayBufferView} input
 * @returns {ArrayBuffer}
 */
export function stripAvifMetadata(input) {
  const container = inspectContainer(input);
  const output = new Uint8Array(container.bytes);
  const outputView = createView(output);
  const metadataItems = container.itemInfos.filter(
    (itemInfo) => itemInfo.type === 'Exif' || (itemInfo.type === 'mime' && itemInfo.contentType === XMP_CONTENT_TYPE),
  );
  const metadataItemIds = new Set(metadataItems.map((itemInfo) => itemInfo.id));
  const metadataLocations = metadataItems.map((itemInfo) => {
    const location = container.itemLocations.find((candidate) => candidate.id === itemInfo.id);
    if (!location) {
      throw new Error(`AVIF metadata item ${itemInfo.id} does not have a writable location.`);
    }
    const ranges = getDirectItemRanges(location);
    if (!ranges) {
      throw new Error(`AVIF metadata item ${itemInfo.id} uses an unsupported location method.`);
    }
    if (ranges.some((range) => range.end > output.byteLength)) {
      throw new Error(`AVIF metadata item ${itemInfo.id} points outside the file.`);
    }
    if (itemPayloadOverlapsAnotherItem(container, location, metadataItemIds)) {
      throw new Error(`AVIF metadata item ${itemInfo.id} overlaps non-metadata image data.`);
    }
    return { location, ranges };
  });

  for (const { location, ranges } of metadataLocations) {
    for (const range of ranges) {
      output.fill(0, range.start, range.end);
    }
    for (const extent of location.extents) {
      writeSizedInteger(outputView, extent.length, 0);
    }
  }
  return output.buffer;
}
