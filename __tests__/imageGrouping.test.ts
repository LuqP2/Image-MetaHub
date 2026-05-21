import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../types';
import { groupImages } from '../utils/imageGrouping';

const makeImage = (id: string, name: string, lastModified: number, models: string[] = []): IndexedImage => ({
  id,
  name,
  handle: { name } as FileSystemFileHandle,
  metadata: {},
  metadataString: '',
  lastModified,
  models,
  loras: [],
  scheduler: '',
});

describe('imageGrouping', () => {
  it('groups images by local date while preserving incoming order', () => {
    const firstDay = new Date(2026, 4, 20, 18, 30).getTime();
    const nextDay = new Date(2026, 4, 21, 9, 15).getTime();

    const result = groupImages([
      makeImage('a', 'a.png', firstDay),
      makeImage('b', 'b.png', firstDay + 1000),
      makeImage('c', 'c.png', nextDay),
    ], 'date');

    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((group) => group.count)).toEqual([2, 1]);
    expect(result.items.map((item) => item.type === 'group-header' ? item.group.id : item.image.id)).toEqual([
      'date-2026-05-20',
      'a',
      'b',
      'date-2026-05-21',
      'c',
    ]);
  });

  it('groups names by first normalized letter and puts numeric or symbol names under #', () => {
    const result = groupImages([
      makeImage('a', 'apple.png', 1),
      makeImage('b', 'Banana.png', 2),
      makeImage('c', '2-cats.png', 3),
      makeImage('d', '_draft.png', 4),
    ], 'name');

    expect(result.groups.map((group) => group.label)).toEqual(['A', 'B', '#']);
    expect(result.groups.map((group) => group.count)).toEqual([1, 1, 2]);
  });

  it('splits sessions after gaps greater than 45 minutes', () => {
    const base = new Date(2026, 4, 21, 9, 0).getTime();
    const minute = 60 * 1000;

    const result = groupImages([
      makeImage('first-a', 'first-a.png', base, ['model-a']),
      makeImage('first-b', 'first-b.png', base + 10 * minute, ['model-a']),
      makeImage('second-a', 'second-a.png', base + 60 * minute, ['model-b']),
      makeImage('third-a', 'third-a.png', base + 150 * minute, ['model-c']),
    ], 'session', { sortOrder: 'date-asc' });

    expect(result.groups).toHaveLength(3);
    expect(result.groups.map((group) => group.count)).toEqual([2, 1, 1]);
    expect(result.groups[0].startImageId).toBe('first-a');
    expect(result.groups[0].subtitle).toBe('Dominant model: model-a');
  });

  it('keeps stable session group ids for the same filtered input', () => {
    const base = new Date(2026, 4, 21, 9, 0).getTime();
    const images = [
      makeImage('a', 'a.png', base),
      makeImage('b', 'b.png', base + 5 * 60 * 1000),
    ];

    expect(groupImages(images, 'session').groups.map((group) => group.id)).toEqual(
      groupImages(images, 'session').groups.map((group) => group.id),
    );
  });

  it('orders sessions from the explicit sort order instead of endpoint timestamps', () => {
    const base = new Date(2026, 4, 21, 9, 0).getTime();
    const minute = 60 * 1000;
    const nameSortedImages = [
      makeImage('middle', 'alpha.png', base + 90 * minute),
      makeImage('newest', 'beta.png', base + 180 * minute),
      makeImage('oldest', 'zeta.png', base),
    ];

    expect(groupImages(nameSortedImages, 'session', { sortOrder: 'date-asc' }).groups.map((group) => group.startImageId)).toEqual([
      'oldest',
      'middle',
      'newest',
    ]);
    expect(groupImages(nameSortedImages, 'session', { sortOrder: 'asc' }).groups.map((group) => group.startImageId)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });
});
