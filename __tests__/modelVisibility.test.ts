import { expect, it } from 'vitest';
import { normalizeModelLocalMetadata, promoteModelLocalMetadata } from '../services/modelLibrary/localMetadataStorage';
import { getModelLocalMetadata } from '../services/modelLibrary/presentation';

it('defaults existing records to visible and preserves hidden state through normalization and SHA identity promotion', () => {
  expect(normalizeModelLocalMetadata({ id: 'location:one' }).hidden).toBe(false);
  const hidden = normalizeModelLocalMetadata({ id: 'location:one', hidden: true, favorite: true, tags: ['portrait'] });
  expect(normalizeModelLocalMetadata(hidden).hidden).toBe(true);
  const promoted = promoteModelLocalMetadata(hidden, 'a'.repeat(64));
  const entries = { [promoted.id]: promoted };
  expect(getModelLocalMetadata(entries, { id: 'copy', sha256: 'a'.repeat(64) })?.hidden).toBe(true);
  expect(promoted.favorite).toBe(true);
  expect(promoted.tags).toEqual(['portrait']);
  expect(normalizeModelLocalMetadata({ ...promoted, hidden: false }).hidden).toBe(false);
});
