import { describe, expect, it } from 'vitest';
import { reconcileModelInspectorCatalog } from '../electron/modelInspectorCatalog.mjs';

const hash = 'a'.repeat(64);
describe('Inspector after physical model removal', () => {
  it('keeps the selected logical model on a surviving copy and retains notes and usage', () => {
    const original = { id: 'one', sha256: hash }, copy = { id: 'copy', sha256: hash };
    const snapshot = { items: [{ location: original }, { location: copy }], selectedId: 'one', followSelection: false };
    const state = { catalog: { locations: [copy] }, localMetadata: { [`sha256:${hash}`]: { notes: 'Keep notes' } }, usage: { [`sha256:${hash}`]: { totalCount: 3 } } };
    expect(reconcileModelInspectorCatalog(snapshot, state)).toEqual({ ...snapshot, selectedId: 'copy', items: [{ location: copy, localMetadata: { notes: 'Keep notes' }, usage: { totalCount: 3 } }] });
  });
  it('clears the removed model from the Inspector when no location remains', () => {
    expect(reconcileModelInspectorCatalog({ items: [{ location: { id: 'one', sha256: hash } }], selectedId: 'one' }, { catalog: { locations: [] }, localMetadata: {} })).toEqual({ items: [], selectedId: null });
  });
});
