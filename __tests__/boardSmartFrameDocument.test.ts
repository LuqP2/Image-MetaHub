import { describe, expect, it } from 'vitest';
import { applyBoardReferenceRemaps, createBoardDocument, normalizeBoardDocument } from '../services/boards/document.mjs';
import { importBoard, exportBoard } from '../services/boards/importExport';
import { createSmartFrame, branchSmartFrame, duplicateSmartFrameQuery } from '../services/boards/smartFrameOperations';
import { boardWithAsset, boardRemap } from './helpers/boardFixtures';
import type { BoardSmartFrameObject } from '../services/boards/queryTypes';

describe('Smart Frame document boundary', () => {
  it('migrates v1 without changing revision, geometry, IDs or timestamps', () => {
    const current = boardWithAsset();
    const migrated = normalizeBoardDocument({ ...current, schemaVersion: 1 });
    expect(migrated).toEqual(current);
    expect(migrated.schemaVersion).toBe(2);
    const imported = importBoard(JSON.stringify({ format: 'image-metahub-board', version: 1, document: { ...current, schemaVersion: 1 } }));
    expect(imported.id).not.toBe(current.id);
    expect(imported.objects).toEqual(current.objects);
  });
  it('round-trips definitions while stripping runtime data and visibility settings', () => {
    const document = createSmartFrame(createBoardDocument(), { source: { kind: 'collection', collectionId: 'missing-local-collection' } });
    const input = structuredClone(document) as any;
    input.objects[0].imageIds = ['transient'];
    input.objects[0].criteria.safeMode = { enableSafeMode: false };
    const normalized = normalizeBoardDocument(input);
    expect(normalized).toEqual(document);
    expect(JSON.parse(exportBoard(normalized)).version).toBe(2);
    expect(importBoard(exportBoard(normalized)).objects).toEqual(document.objects);
  });
  it('rejects invalid types, cycles, matrix axes and expression limits', () => {
    const document = createSmartFrame(createBoardDocument(), { id: 'a' });
    const frame = document.objects[0] as BoardSmartFrameObject;
    const invalid = (patch: object) => ({ ...document, objects: [{ ...frame, ...patch }] });
    expect(() => normalizeBoardDocument(invalid({ source: { kind: 'frame', frameId: 'a' } }))).toThrow();
    expect(() => normalizeBoardDocument(invalid({ layout: { kind: 'matrix', rows: 'lora', columns: 'lora' } }))).toThrow();
    expect(() => normalizeBoardDocument(invalid({ criteria: { ...frame.criteria, selectedRatings: [7] } }))).toThrow();
    expect(() => normalizeBoardDocument(invalid({ source: { kind: 'intersection', inputs: Array.from({ length: 10001 }, () => ({ kind: 'library' })) } }))).toThrow();
    let source: any = { kind: 'library' };
    for (let i = 0; i < 66; i++) source = { kind: 'difference', left: source, right: { kind: 'library' } };
    expect(() => normalizeBoardDocument(invalid({ source }))).toThrow();
    expect(() => normalizeBoardDocument({ ...document, schemaVersion: 3 })).toThrow();
  });
  it('rejects existing non-frame sources but preserves missing source IDs', () => {
    const document = createSmartFrame(boardWithAsset(), { source: { kind: 'frame', frameId: 'missing' } });
    expect(normalizeBoardDocument(document)).toEqual(document);
    const frame = document.objects[1] as BoardSmartFrameObject;
    expect(() => normalizeBoardDocument({ ...document, objects: [document.objects[0], { ...frame, source: { kind: 'frame', frameId: document.objects[0].id } }] })).toThrow();
  });
  it('remaps nested snapshots idempotently after independent duplication', () => {
    const asset = boardWithAsset().objects[0] as any;
    let document = createSmartFrame(createBoardDocument(), { id: 'parent', source: { kind: 'snapshot', references: [asset.reference] } });
    document = branchSmartFrame(document, 'parent');
    document = duplicateSmartFrameQuery(document, document.objects[1].id);
    const once = applyBoardReferenceRemaps(document, [boardRemap('a.png', 'b.png')]);
    expect(applyBoardReferenceRemaps(once, [boardRemap('a.png', 'b.png')])).toEqual(once);
    const copy = once.objects[2] as BoardSmartFrameObject;
    expect(copy.source.kind).toBe('query');
    expect(JSON.stringify(copy.source)).toContain('b.png');
    if (copy.source.kind === 'query' && copy.source.source.kind === 'snapshot') expect(copy.source.source.references[0].locator.relativePath).toBe('b.png');
  });
});

it('validates dependency depth identically in root-first and leaf-first order', () => {
  const base = createBoardDocument();
  const template = createSmartFrame(base).objects[0] as BoardSmartFrameObject;
  const chain = (edges: number) => Array.from({ length: edges + 1 }, (_, index) => ({ ...template, id: String(index),
    source: index === 0 ? { kind: 'library' as const } : { kind: 'frame' as const, frameId: String(index - 1) },
  }));
  for (const reversed of [false, true]) {
    const valid = chain(64); if (reversed) valid.reverse();
    expect(() => normalizeBoardDocument({ ...base, objects: valid })).not.toThrow();
    for (const edges of [65, 69]) {
      const invalid = chain(edges); if (reversed) invalid.reverse();
      expect(() => normalizeBoardDocument({ ...base, objects: invalid })).toThrow('deep frame dependency');
    }
  }
});
