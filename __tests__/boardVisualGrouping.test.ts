import { describe, expect, it } from 'vitest';
import { groupVisualVectors } from '../services/boards/visualGrouping';
import { applyVisualGroups, visualGroupingCandidates, visualGroupFingerprint } from '../services/boards/visualGroupOperations';
import { createStack } from '../services/boards/stackOperations';
import { addAssets, createFrame } from '../services/boards/operations';
import { createBoardDocument } from '../services/boards/document.mjs';
import { boardLocator } from './helpers/boardFixtures';

const vector = (imageId: string, angle: number) => ({ imageId, vector: new Float32Array([Math.cos(angle), Math.sin(angle)]) });
describe('visual grouping', () => {
  it('uses complete linkage instead of transitive similarity chains', async () => {
    const input = [vector('a', 0), vector('b', 0.5), vector('c', 1)];
    const result = await groupVisualVectors(input, 0.75);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toHaveLength(2);
    expect(result.groups[0]).not.toEqual(['a', 'b', 'c']);
    expect(result.isolated).toHaveLength(1);
    expect(await groupVisualVectors(input.reverse(), 0.75)).toEqual(result);
  });
  it('separates known groups, normalizes input and handles identical vectors', async () => {
    expect(await groupVisualVectors([vector('a', 0), vector('b', 0.02), vector('c', 2), vector('d', 2.02), vector('e', -2)], 0.95)).toEqual({ groups: [['a', 'b'], ['c', 'd']], isolated: ['e'] });
    expect((await groupVisualVectors([vector('a', 0), vector('b', 0), vector('c', 0)], 1)).groups).toEqual([['a', 'b', 'c']]);
  });
  it('merges the nearest pair before a weaker eligible neighbor', async () => {
    const result = await groupVisualVectors([vector('a', 0), vector('b', 0.5), vector('c', 0.9)], 0.85);
    expect(result).toEqual({ groups: [['b', 'c']], isolated: ['a'] });
  });
  it('matches a full agglomerative reference on deterministic small datasets', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      let random = seed;
      const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 0xffffffff; };
      const input = Array.from({ length: 12 }, (_, i) => ({ imageId: String(i).padStart(2, '0'), vector: new Float32Array([next(), next(), next()]) }));
      const normalized = input.map(item => {
        const norm = Math.sqrt(item.vector.reduce((sum, value) => sum + value * value, 0));
        return Float32Array.from(item.vector, value => value / norm);
      });
      const clusters = input.map((_, i) => [i]);
      while (true) {
        let best = 0.9 - 1e-7, pair: [number, number] | null = null;
        for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
          let similarity = 1;
          for (const left of clusters[i]) for (const right of clusters[j]) similarity = Math.min(similarity, normalized[left].reduce((sum, value, d) => sum + value * normalized[right][d], 0));
          if (similarity > best) { best = similarity; pair = [i, j]; }
        }
        if (!pair) break;
        clusters[pair[0]].push(...clusters[pair[1]]); clusters.splice(pair[1], 1);
      }
      const expected = clusters.map(group => group.map(i => input[i].imageId).sort()).sort((a, b) => a[0].localeCompare(b[0]));
      const result = await groupVisualVectors(input, 0.9);
      expect([...result.groups, ...result.isolated.map(id => [id])].sort((a, b) => a[0].localeCompare(b[0]))).toEqual(expected);
    }
  });
  it('rejects invalid vectors and cancels without producing a result', async () => {
    await expect(groupVisualVectors([{ imageId: 'a', vector: new Float32Array(2) }], 0.75)).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    await expect(groupVisualVectors([vector('a', 0)], 0.75, () => {}, controller.signal)).rejects.toThrow();
    expect(await groupVisualVectors([], 0.75)).toEqual({ groups: [], isolated: [] });
  });
  it('only groups eligible Canvas objects, preserves outside objects and detects changes', () => {
    const document = addAssets(createBoardDocument(), ['a', 'b', 'c', 'd', 'e'].map(name => ({ name, mediaType: 'image' as const, reference: { kind: 'path' as const, locator: boardLocator(name) } })), { x: 0, y: 0 });
    const ids = document.objects.map(object => object.id);
    const stacked = createStack(document, ids.slice(0, 2));
    const framed = createFrame(stacked, [ids[2]]);
    expect(visualGroupingCandidates(framed).map(object => object.id)).toEqual(ids.slice(3));
    expect(visualGroupingCandidates(framed, [framed.objects.find(object => object.type === 'frame')!.id]).map(object => object.id)).toEqual([ids[2]]);
    const result = applyVisualGroups(framed, [ids.slice(3)]);
    expect(result.objects.filter(object => object.type === 'frame')).toHaveLength(2);
    expect(result.objects.find(object => object.id === ids[0])).toEqual(framed.objects.find(object => object.id === ids[0]));
    expect(visualGroupFingerprint(result, ids.slice(3))).not.toBe(visualGroupFingerprint(framed, ids.slice(3)));
    expect(() => applyVisualGroups(stacked, [ids.slice(0, 2)])).toThrow();
    const group = result.objects.find(object => object.type === 'frame' && object.title === 'Visual group 1')!;
    for (const obstacle of framed.objects.filter(object => !ids.slice(3).includes(object.id))) {
      expect(group.x + group.width <= obstacle.x || obstacle.x + obstacle.width <= group.x || group.y + group.height <= obstacle.y || obstacle.y + obstacle.height <= group.y).toBe(true);
    }
  });
});
