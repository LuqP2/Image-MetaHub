import type { BoardDocument, BoardPromptInput, BoardPromptObject } from './types';
import { normalizeBoardDocument } from './document.mjs';
import { findContainingFrame, findFreeBoardPosition, type BoardPoint } from './layout';
import { useBoardStore } from '../../store/useBoardStore';
import { visibleBoardCenter, boardVisibleArea } from './viewport';

export const PROMPT_DRAG_TYPE = 'application/x-imagemetahub-canvas-prompt';
export { normalizePromptMatch, imagePromptText, promptImageKey, buildPromptIndex, uniquePromptImages } from './promptMatching';
export function addPromptObject(document: BoardDocument, input: BoardPromptInput, anchor: BoardPoint, automatic = false): BoardDocument {
  const point = automatic ? findFreeBoardPosition(document.objects, { width: 320, height: 240 }, { x: anchor.x - 160, y: anchor.y - 120 }) : anchor;
  const object: BoardPromptObject = { ...structuredClone(input), id: crypto.randomUUID(), type: 'prompt', ...point, width: 320, height: 240, frameId: null, zIndex: Math.max(0, ...document.objects.map(item => item.zIndex)) + 1 };
  object.frameId = findContainingFrame(object, document.objects)?.id ?? null;
  return normalizeBoardDocument({ ...document, objects: [...document.objects, object], updatedAt: Date.now() });
}
export function addPromptToBoard(boardId: string, input: BoardPromptInput, anchor?: BoardPoint) {
  const state = useBoardStore.getState();
  const session = state.sessions[boardId];
  if (!session || state.closing || session.recovering || state.activeBoardId !== boardId) throw new Error('This board is not available for editing.');
  const stage = document.querySelector<HTMLElement>('.board-stage');
  const point = anchor ?? visibleBoardCenter(session.document.viewport, stage ? boardVisibleArea(stage) : { x: 0, y: 0, width: 800, height: 600 });
  let id = '';
  state.executeOperation(boardId, document => {
    const next = addPromptObject(document, input, point, !anchor);
    id = next.objects[next.objects.length - 1].id;
    return next;
  });
  state.setSelection(boardId, [id]);
  if (!anchor) state.requestReveal(boardId, [id]);
  return id;
}
export function setPromptDrag(data: DataTransfer, input: BoardPromptInput) {
  data.effectAllowed = 'copy';
  data.setData(PROMPT_DRAG_TYPE, JSON.stringify({ version: 1, prompt: input }));
}
export function readPromptDrag(data: DataTransfer): BoardPromptInput {
  let value;
  try { value = JSON.parse(data.getData(PROMPT_DRAG_TYPE)); } catch { throw new Error('Invalid prompt drag data.'); }
  if (value?.version !== 1 || !value.prompt || typeof value.prompt.title !== 'string' || typeof value.prompt.positivePrompt !== 'string' || typeof value.prompt.negativePrompt !== 'string') throw new Error('Invalid prompt drag data.');
  // Use the shared document boundary to validate origins and discard unknown runtime fields.
  const test = addPromptObject({ schemaVersion: 5, id: crypto.randomUUID(), name: 'Validation', revision: 0, createdAt: 0, updatedAt: 0, objects: [], connections: [], viewport: { x: 0, y: 0, zoom: 1 } }, value.prompt, { x: 0, y: 0 }).objects[0] as BoardPromptObject;
  return { title: test.title, positivePrompt: test.positivePrompt, negativePrompt: test.negativePrompt, ...(test.origin ? { origin: test.origin } : {}) };
}
