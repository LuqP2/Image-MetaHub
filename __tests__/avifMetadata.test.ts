import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getAvifDimensions,
  IMAGE_METAHUB_XMP_NAMESPACE,
  isAvifBuffer,
  parseAvifMetadata,
  rewriteAvifMetadata,
  stripAvifMetadata,
} from '../utils/avifMetadata.mjs';

const encoder = new TextEncoder();

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

const ascii = (value: string): Uint8Array => encoder.encode(value);

const containsSequence = (haystack: Uint8Array, needle: Uint8Array): boolean => {
  if (needle.byteLength === 0) return true;
  for (let offset = 0; offset <= haystack.byteLength - needle.byteLength; offset += 1) {
    if (needle.every((value, index) => haystack[offset + index] === value)) return true;
  }
  return false;
};

const uint16 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value);
  return bytes;
};

const uint32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
};

const uint64 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
};

const box = (type: string, payload: Uint8Array): Uint8Array =>
  concat(uint32(payload.byteLength + 8), ascii(type), payload);

const fullBox = (type: string, version: number, payload: Uint8Array): Uint8Array =>
  box(type, concat(new Uint8Array([version, 0, 0, 0]), payload));

interface AvifItem {
  id: number;
  type: 'mime' | 'Exif';
  contentType?: string;
  parts: Uint8Array[];
}

type IntegerWidth = 0 | 4 | 8;

const writeSizedInteger = (value: number, width: IntegerWidth): Uint8Array => {
  if (width === 0) return new Uint8Array();
  return width === 4 ? uint32(value) : uint64(value);
};

const buildItemInfoEntry = (item: AvifItem): Uint8Array => {
  const itemName = item.type === 'mime' ? 'XMP' : 'Exif';
  const trailing = item.type === 'mime'
    ? concat(ascii(`${itemName}\0${item.contentType ?? ''}\0`))
    : ascii(`${itemName}\0`);

  return fullBox(
    'infe',
    2,
    concat(uint16(item.id), uint16(0), ascii(item.type), trailing),
  );
};

const buildItemInfo = (items: AvifItem[]): Uint8Array =>
  fullBox('iinf', 0, concat(uint16(items.length), ...items.map(buildItemInfoEntry)));

interface ItemLocation {
  item: AvifItem;
  offsets: number[];
}

const buildItemLocations = (
  locations: ItemLocation[],
  offsetWidth: IntegerWidth,
  lengthWidth: IntegerWidth,
): Uint8Array => {
  const entries = locations.map(({ item, offsets }) => concat(
    uint16(item.id),
    uint16(0),
    uint16(0),
    uint16(item.parts.length),
    ...item.parts.flatMap((part, index) => [
      writeSizedInteger(offsets[index], offsetWidth),
      writeSizedInteger(part.byteLength, lengthWidth),
    ]),
  ));

  return fullBox(
    'iloc',
    1,
    concat(
      new Uint8Array([(offsetWidth << 4) | lengthWidth, 0]),
      uint16(locations.length),
      ...entries,
    ),
  );
};

const buildProperties = (width: number, height: number): Uint8Array => {
  const spatialExtents = fullBox('ispe', 0, concat(uint32(width), uint32(height)));
  return box('iprp', box('ipco', spatialExtents));
};

const buildFileType = (majorBrand = 'avif'): Uint8Array =>
  box('ftyp', concat(ascii(majorBrand), uint32(0), ascii('avif'), ascii('mif1')));

const buildAvif = (
  items: AvifItem[],
  options: {
    width?: number;
    height?: number;
    offsetWidth?: IntegerWidth;
    lengthWidth?: IntegerWidth;
    majorBrand?: string;
  } = {},
): ArrayBuffer => {
  const {
    width = 640,
    height = 480,
    offsetWidth = 4,
    lengthWidth = 4,
    majorBrand = 'avif',
  } = options;
  const fileType = buildFileType(majorBrand);
  const itemInfo = buildItemInfo(items);
  const properties = buildProperties(width, height);
  const placeholderLocations: ItemLocation[] = items.map((item) => ({
    item,
    offsets: item.parts.map(() => 0),
  }));
  const placeholderIloc = buildItemLocations(
    placeholderLocations,
    offsetWidth,
    lengthWidth,
  );
  const placeholderMeta = fullBox('meta', 0, concat(itemInfo, placeholderIloc, properties));
  let payloadOffset = fileType.byteLength + placeholderMeta.byteLength + 8;
  const locations: ItemLocation[] = items.map((item) => {
    const offsets = item.parts.map((part) => {
      const currentOffset = payloadOffset;
      payloadOffset += part.byteLength;
      return currentOffset;
    });
    return { item, offsets };
  });
  const itemLocations = buildItemLocations(locations, offsetWidth, lengthWidth);
  const meta = fullBox('meta', 0, concat(itemInfo, itemLocations, properties));
  const imagePayload = new Uint8Array([0x81, 0x49, 0x4d, 0x48, 0x2d, 0x41, 0x56, 0x31]);
  const mediaData = box(
    'mdat',
    concat(...items.flatMap((item) => item.parts), imagePayload),
  );
  return concat(fileType, meta, mediaData).buffer;
};

const escapeXml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const buildComfyXmp = (prompt: object, workflow: object): string => {
  const promptJson = JSON.stringify(prompt);
  const workflowJson = JSON.stringify(workflow);
  return [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `    <rdf:Description xmlns:comfy="https://github.com/Comfy-Org/ComfyUI" xmlns:dc="http://purl.org/dc/elements/1.1/" comfy:prompt="${escapeXml(promptJson)}">`,
    '      <dc:title>Foreign title</dc:title>',
    `      <comfy:workflow>${escapeXml(workflowJson)}</comfy:workflow>`,
    '    </rdf:Description>',
    '  </rdf:RDF>',
    '</x:xmpmeta>',
  ].join('\n');
};

const buildPixelMetaXmp = (
  prompt: object,
  nestedPrompt: object,
): string => [
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
  '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '    <rdf:Description xmlns:pm="https://ai-foundry.dev/ns/pixelmeta/1.0/" pm:version="1">',
  `      <pm:prompt>${escapeXml(JSON.stringify(prompt))}</pm:prompt>`,
  `      <pm:imagemetahub_data>${escapeXml(JSON.stringify({ generator: 'ComfyUI', prompt_api: nestedPrompt }))}</pm:imagemetahub_data>`,
  '    </rdf:Description>',
  '  </rdf:RDF>',
  '</x:xmpmeta>',
].join('\n');

const buildExifPayload = (workflow: object, prompt: object): Uint8Array => {
  const values = [
    ascii(`workflow:${JSON.stringify(workflow)}\0`),
    ascii(`prompt:${JSON.stringify(prompt)}\0`),
  ];
  const entryCount = values.length;
  const firstValueOffset = 8 + 2 + entryCount * 12 + 4;
  let nextValueOffset = firstValueOffset;
  const entries = values.map((value, index) => {
    const tag = index === 0 ? 0x010f : 0x0110;
    const entry = concat(
      uint16(tag),
      uint16(2),
      uint32(value.byteLength),
      uint32(nextValueOffset),
    );
    nextValueOffset += value.byteLength;
    return entry;
  });
  const tiff = concat(
    ascii('MM'),
    uint16(42),
    uint32(8),
    uint16(entryCount),
    ...entries,
    uint32(0),
    ...values,
  );
  return concat(uint32(0), tiff);
};

describe('AVIF metadata carrier', () => {
  it('round-trips compact metadata through a real encoded AVIF fixture', async () => {
    const source = await readFile(path.resolve('__tests__/fixtures/avif/comfy-xmp.avif'));

    const rewritten = rewriteAvifMetadata(source, {
      extension: { version: 1, tags: ['fixture'], notes: 'Real AVIF round trip' },
    });
    const result = await parseAvifMetadata(rewritten);

    expect(getAvifDimensions(rewritten)).toEqual({ width: 2, height: 2 });
    expect(result.rawMetadata).toMatchObject({
      imagemetahub_extension: {
        version: 1,
        tags: ['fixture'],
        notes: 'Real AVIF round trip',
      },
    });
  });

  it('recognizes AVIF through a compatible brand, not only the major brand', () => {
    const buffer = buildAvif([], { majorBrand: 'mif1' });

    expect(isAvifBuffer(buffer)).toBe(true);
  });

  it('reads ComfyUI XMP, dimensions, and foreign namespace presence', async () => {
    const prompt = { '1': { class_type: 'KSampler', inputs: { seed: 42 } } };
    const workflow = { nodes: [{ id: 1, type: 'KSampler' }], version: 1 };
    const xmp = encoder.encode(buildComfyXmp(prompt, workflow));
    const buffer = buildAvif([
      { id: 1, type: 'mime', contentType: 'application/rdf+xml', parts: [xmp] },
    ], { width: 1024, height: 768 });

    const result = await parseAvifMetadata(buffer);

    expect(result.rawMetadata).toMatchObject({
      prompt: JSON.stringify(prompt),
      workflow: JSON.stringify(workflow),
      _carrierFormat: 'avif',
    });
    expect(result.dimensions).toEqual({ width: 1024, height: 768 });
    expect(result.metadataTruncated).toBe(false);
    expect(result.xmpNamespaces).toContain('http://purl.org/dc/elements/1.1/');
  });

  it('reads the primary item ispe for a multi-item AVIF, not the first ispe', () => {
    // Two ispe properties share the ipco container: a 512x512 tile (index 1) and
    // the 8192x8192 full image (index 2). ipma associates primary item 1 with the
    // full-image property, and pitm names item 1 as primary.
    const tileSpatialExtents = fullBox('ispe', 0, concat(uint32(512), uint32(512)));
    const fullSpatialExtents = fullBox('ispe', 0, concat(uint32(8192), uint32(8192)));
    const ipco = box('ipco', concat(tileSpatialExtents, fullSpatialExtents));
    const ipma = fullBox('ipma', 0, concat(
      uint32(1), // entry_count
      uint16(1), // item_ID = 1
      new Uint8Array([1]), // association_count = 1
      new Uint8Array([2]), // property index 2 (the full-image ispe), essential bit clear
    ));
    const iprp = box('iprp', concat(ipco, ipma));
    const pitm = fullBox('pitm', 0, uint16(1)); // primary item id = 1
    const meta = fullBox('meta', 0, concat(pitm, iprp));
    const buffer = concat(buildFileType(), meta).buffer;

    expect(getAvifDimensions(buffer)).toEqual({ width: 8192, height: 8192 });
  });

  it('joins split XMP extents and supports eight-byte iloc values', async () => {
    const prompt = { '8': { class_type: 'LoadImage', inputs: {} } };
    const workflow = { nodes: [{ id: 8, type: 'LoadImage' }] };
    const xmp = encoder.encode(buildComfyXmp(prompt, workflow));
    const splitAt = Math.floor(xmp.byteLength / 2);
    const buffer = buildAvif([
      {
        id: 2,
        type: 'mime',
        contentType: 'application/rdf+xml',
        parts: [xmp.subarray(0, splitAt), xmp.subarray(splitAt)],
      },
    ], { offsetWidth: 8, lengthWidth: 8 });

    const result = await parseAvifMetadata(buffer);

    expect(result.rawMetadata).toMatchObject({
      prompt: JSON.stringify(prompt),
      workflow: JSON.stringify(workflow),
    });
  });

  it('keeps standalone workflow documents canonical and reports legacy conflicts', async () => {
    const canonicalPrompt = { '1': { class_type: 'KSampler', inputs: { seed: 1 } } };
    const conflictingPrompt = { '1': { class_type: 'KSampler', inputs: { seed: 2 } } };
    const xmp = encoder.encode(buildPixelMetaXmp(canonicalPrompt, conflictingPrompt));
    const buffer = buildAvif([
      { id: 3, type: 'mime', contentType: 'application/rdf+xml', parts: [xmp] },
    ]);

    const result = await parseAvifMetadata(buffer);

    expect(result.rawMetadata?.prompt).toBe(JSON.stringify(canonicalPrompt));
    expect(result.rawMetadata?.imagemetahub_data).toMatchObject({
      prompt_api: conflictingPrompt,
    });
    expect(result.rawMetadata?._carrierConflicts).toEqual([
      {
        field: 'prompt',
        canonicalSource: 'xmp.prompt',
        conflictingSource: 'imagemetahub_data.prompt_api',
      },
    ]);
  });

  it('falls back to legacy nested prompt documents when standalone XMP is absent', async () => {
    const legacyPrompt = { '5': { class_type: 'VAEDecode', inputs: {} } };
    const xmp = encoder.encode(buildPixelMetaXmp(legacyPrompt, legacyPrompt).replace(
      /\s*<pm:prompt>.*?<\/pm:prompt>/,
      '',
    ));
    const buffer = buildAvif([
      { id: 4, type: 'mime', contentType: 'application/rdf+xml', parts: [xmp] },
    ]);

    const result = await parseAvifMetadata(buffer);

    expect(result.rawMetadata?.prompt).toBe(JSON.stringify(legacyPrompt));
    expect(result.rawMetadata?._carrierConflicts).toBeUndefined();
  });

  it('does not flag a conflict for identical plain-text prompts across carriers', async () => {
    // A higher-priority (ComfyUI) and a lower-priority (foreign namespace) carrier
    // both store the same non-JSON prompt text. Textually identical documents are
    // the same document, so no CarrierConflict should be reported.
    const promptText = 'a plain text prompt, not json';
    const plainTextXmp = [
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '    <rdf:Description'
        + ' xmlns:comfy="https://github.com/Comfy-Org/ComfyUI"'
        + ' xmlns:legacy="http://example.com/legacy"'
        + ` comfy:prompt="${escapeXml(promptText)}" legacy:prompt="${escapeXml(promptText)}">`,
      '    </rdf:Description>',
      '  </rdf:RDF>',
      '</x:xmpmeta>',
    ].join('\n');
    const buffer = buildAvif([
      { id: 9, type: 'mime', contentType: 'application/rdf+xml', parts: [encoder.encode(plainTextXmp)] },
    ]);

    const result = await parseAvifMetadata(buffer);

    expect(result.rawMetadata?.prompt).toBe(promptText);
    expect(result.rawMetadata?._carrierConflicts).toBeUndefined();
  });

  it('reads the older EXIF workflow convention used by existing ComfyUI AVIF files', async () => {
    const workflow = { nodes: [{ id: 7, type: 'KSampler' }] };
    const prompt = { '7': { class_type: 'KSampler', inputs: {} } };
    const buffer = buildAvif([
      { id: 5, type: 'Exif', parts: [buildExifPayload(workflow, prompt)] },
    ]);

    const result = await parseAvifMetadata(buffer);

    expect(result.rawMetadata).toMatchObject({
      workflow: JSON.stringify(workflow),
      prompt: JSON.stringify(prompt),
    });
  });

  it('signals a head read that does not contain the referenced XMP payload', async () => {
    const prompt = { '1': { class_type: 'KSampler', inputs: {} } };
    const xmp = encoder.encode(buildComfyXmp(prompt, { nodes: [] }));
    const complete = buildAvif([
      { id: 6, type: 'mime', contentType: 'application/rdf+xml', parts: [xmp] },
    ]);
    const head = complete.slice(0, Math.max(64, complete.byteLength - xmp.byteLength));

    const result = await parseAvifMetadata(head);

    expect(result.rawMetadata).toBeNull();
    expect(result.metadataTruncated).toBe(true);
  });

  it('signals a head read that ends before a later metadata box', async () => {
    const head = concat(
      buildFileType(),
      uint32(4096),
      ascii('mdat'),
      new Uint8Array(32),
    ).buffer;

    const result = await parseAvifMetadata(head);

    expect(result.rawMetadata).toBeNull();
    expect(result.metadataTruncated).toBe(true);
  });

  it('rejects metadata rewrites when no standard XMP item exists', () => {
    const source = buildAvif([]);

    expect(() => rewriteAvifMetadata(source, {
      extension: { version: 1, tags: ['cannot-write'] },
    })).toThrow('Expected exactly one writable AVIF XMP item, found 0.');
  });

  it('rewrites only the Image MetaHub XMP extension and remains repeatable', async () => {
    const prompt = { '1': { class_type: 'KSampler', inputs: { seed: 9 } } };
    const workflow = { nodes: [{ id: 1, type: 'KSampler' }] };
    const source = buildAvif([
      {
        id: 7,
        type: 'mime',
        contentType: 'application/rdf+xml',
        parts: [encoder.encode(buildComfyXmp(prompt, workflow))],
      },
    ]);

    const first = rewriteAvifMetadata(source, {
      extension: { version: 1, tags: ['favorite'], notes: 'First note' },
    });
    const second = rewriteAvifMetadata(first, {
      extension: { version: 1, tags: ['favorite'], notes: 'New note' },
    });
    const result = await parseAvifMetadata(second);

    expect(result.rawMetadata).toMatchObject({
      prompt: JSON.stringify(prompt),
      workflow: JSON.stringify(workflow),
      imagemetahub_extension: {
        version: 1,
        tags: ['favorite'],
        notes: 'New note',
      },
    });
    expect(result.xmpNamespaces).toContain(IMAGE_METAHUB_XMP_NAMESPACE);
    expect(result.xmpNamespaces).toContain('http://purl.org/dc/elements/1.1/');
    expect(result.rawMetadata?.imagemetahub_data).toBeUndefined();
    expect(result.rawMetadata?.parameters).toBeUndefined();
    expect(second.byteLength).toBe(first.byteLength);
  });

  it('strips EXIF and XMP item payloads without changing the encoded image bytes', async () => {
    const imageMarker = new Uint8Array([0x81, 0x49, 0x4d, 0x48, 0x2d, 0x41, 0x56, 0x31]);
    const xmp = encoder.encode(buildComfyXmp({ '1': { class_type: 'KSampler' } }, { nodes: [] }));
    const source = buildAvif([
      { id: 8, type: 'mime', contentType: 'application/rdf+xml', parts: [xmp] },
      { id: 9, type: 'Exif', parts: [buildExifPayload({ nodes: [] }, {})] },
    ]);

    const stripped = stripAvifMetadata(source);
    const result = await parseAvifMetadata(stripped);

    expect(result.rawMetadata).toBeNull();
    expect(result.metadataTruncated).toBe(false);
    expect(containsSequence(new Uint8Array(stripped), imageMarker)).toBe(true);
    expect(containsSequence(new Uint8Array(stripped), xmp)).toBe(false);
  });

  it('rejects stripping when a declared metadata item cannot be physically scrubbed', () => {
    const xmp = encoder.encode(buildComfyXmp({ '1': { class_type: 'KSampler' } }, { nodes: [] }));
    const item: AvifItem = {
      id: 10,
      type: 'mime',
      contentType: 'application/rdf+xml',
      parts: [xmp],
    };
    const source = concat(
      buildFileType(),
      fullBox('meta', 0, concat(buildItemInfo([item]), buildProperties(640, 480))),
      box('mdat', xmp),
    ).buffer;

    expect(() => stripAvifMetadata(source)).toThrow(
      'AVIF metadata item 10 does not have a writable location.',
    );
  });
});
