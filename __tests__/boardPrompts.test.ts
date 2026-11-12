import { describe, expect, it } from 'vitest';
import { createBoardDocument, normalizeBoardDocument, applyBoardReferenceRemaps } from '../services/boards/document.mjs';
import { addPromptObject, normalizePromptMatch, buildPromptIndex, readPromptDrag, setPromptDrag } from '../services/boards/prompts';
import { createFrame, duplicateObjects, addConnection, updateObjects } from '../services/boards/operations';
import { copyBoardFragment, parseBoardFragment, pasteBoardFragment } from '../services/boards/clipboard';
import { exportBoard, importBoard } from '../services/boards/importExport';
import { pngExportDocument } from '../services/boards/pngExport';
import { boardImage } from './helpers/boardIntegrationFixtures';
import type { BoardPromptObject, BoardPromptInput } from '../services/boards/types';
import { materializeCanvasPrompt } from '../components/boards/PromptCardDialog';
import { emptyEditor, makeDocument } from '../services/promptLibrary/core.mjs';
import type { SavedPrompt } from '../types';

const input: BoardPromptInput = { title: 'Portrait', positivePrompt: 'Cat, (soft light:1.2)', negativePrompt: 'blur', origin: { kind: 'library', id: 'saved-prompt', revision: 2 } };
const board = () => addPromptObject(createBoardDocument(), input, { x: 20, y: 30 });
describe('Canvas prompt document and matching', () => {
  it('round trips independent content, origin and geometry through storage, import and clipboard', () => {
    const original = board();
    const card = original.objects[0] as BoardPromptObject;
    expect(card).toMatchObject({ ...input, width: 320, height: 240, x: 20, y: 30 });
    expect(normalizeBoardDocument(original)).toEqual(original);
    expect(importBoard(exportBoard(original)).objects).toEqual(original.objects);
    const pasted = pasteBoardFragment(createBoardDocument(), parseBoardFragment(copyBoardFragment(original, [card.id]))!, { x: 100, y: 200 });
    expect(pasted.document.objects[0]).toMatchObject({ ...input, x: 100, y: 200 });
    expect(pasted.ids[0]).not.toBe(card.id);
    expect(pngExportDocument(original).objects).toEqual(original.objects);
  });
  it.each([1, 2, 3, 4])('migrates schema %i without dropping existing data', version => {
    const old = { ...createBoardDocument(), schemaVersion: version, revision: 7 };
    expect(normalizeBoardDocument(old)).toMatchObject({ schemaVersion: 5, revision: 7 });
    expect(old.schemaVersion).toBe(version);
  });
  it('rejects cards in older schemas and malformed origins; discards runtime match fields', () => {
    const doc = board();
    expect(() => normalizeBoardDocument({ ...doc, schemaVersion: 4 })).toThrow('schema v5');
    expect(() => normalizeBoardDocument({ ...doc, objects: [{ ...doc.objects[0], origin: { kind: 'network' } }] })).toThrow('origin');
    expect(normalizeBoardDocument({ ...doc, objects: [{ ...doc.objects[0], matchedIds: ['a'] }] }).objects[0]).not.toHaveProperty('matchedIds');
  });
  it('supports frame adoption, resizing, duplication and manual connections', () => {
    const frameDoc = createFrame(createBoardDocument(), [], { x: 0, y: 0 });
    const next = addPromptObject(frameDoc, input, { x: 20, y: 30 });
    const card = next.objects.find(object => object.type === 'prompt')!;
    expect(card.frameId).toBe(frameDoc.objects[0].id);
    const resized = updateObjects(next, [{ id: card.id, width: 400, height: 300 }]);
    expect(resized.objects.find(object => object.id === card.id)).toMatchObject({ width: 400, height: 300 });
    const duplicate = duplicateObjects(resized, [card.id]);
    const copy = duplicate.objects.find(object => !resized.objects.some(old => old.id === object.id))!;
    expect(addConnection(duplicate, { sourceObjectId: card.id, targetObjectId: copy.id, sourceSide: 'right', targetSide: 'left', label: 'variation', color: '#112233' }).connections).toHaveLength(1);
  });
  it('remaps image origins while preserving prompt text', () => {
    const locator = { imageId: 'before', directoryPath: 'C:/images', relativePath: 'before.png' };
    const doc = addPromptObject(createBoardDocument(), { ...input, origin: { kind: 'image', reference: { kind: 'path', locator } } }, { x: 0, y: 0 });
    const next = applyBoardReferenceRemaps(doc, [{ operationId: 'rename', oldLocator: locator, newLocator: { ...locator, imageId: 'after', relativePath: 'after.png' } }]);
    expect(next.objects[0]).toMatchObject({ positivePrompt: input.positivePrompt, origin: { reference: { locator: { relativePath: 'after.png' } } } });
  });
  it('matches only normalized full positive and keeps case, weights, internal whitespace and punctuation', () => {
    const images = [' Cat, (light:1.2)\r\nblue ', 'Cat, (light:1.2)\nblue', 'cat, (light:1.2)\nblue', 'Cat, (light:1.3)\nblue', 'Cat,  (light:1.2)\nblue', 'Cat (light:1.2)\nblue', ''].map((prompt, index) => boardImage(`${index}.png`, { metadata: { normalizedMetadata: { prompt, negativePrompt: String(index) } } as never }));
    const index = buildPromptIndex(images);
    expect(index.get(normalizePromptMatch(images[0].metadata!.normalizedMetadata!.prompt))).toEqual(images.slice(0, 2));
    expect(index.has('')).toBe(false);
    expect(buildPromptIndex([boardImage('movie.mp4', { metadata: images[0].metadata })]).size).toBe(0);
  });
  it('validates and materializes the versioned drag payload', () => {
    const values = new Map<string, string>();
    const data = { setData: (key: string, value: string) => values.set(key, value), getData: (key: string) => values.get(key) } as DataTransfer;
    setPromptDrag(data, input);
    expect(readPromptDrag(data)).toEqual(input);
    for (const key of values.keys()) values.set(key, '{"version":2}');
    expect(() => readPromptDrag(data)).toThrow('Invalid prompt');
  });
  it('materializes template values into an independent snapshot and rejects missing values', () => {
    const editor = emptyEditor();
    editor.title = 'My template'; editor.document = { ...makeDocument('portrait of {{subject}}', 'blur'), mode: 'template', variables: [{ name: 'subject', label: 'Subject', type: 'text', required: true, options: [], defaultValue: '' }] };
    const item = { id: 'template', revision: 3, positivePrompt: '', negativePrompt: '', editor } as SavedPrompt;
    expect(() => materializeCanvasPrompt(item)).toThrow('Fill');
    const card = materializeCanvasPrompt(item, { subject: 'cat' });
    editor.title = 'Changed';
    expect(card).toMatchObject({ title: 'My template', positivePrompt: 'portrait of cat', negativePrompt: 'blur', origin: { revision: 3 } });
  });
});
