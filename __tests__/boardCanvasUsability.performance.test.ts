import { expect, it } from 'vitest';
import { evaluateBoardQueries, createBoardEvaluationCache } from '../services/boards/queryEvaluator';
import { normalizeLibraryQueryCriteria } from '../services/libraryQuery/criteria';
import { toLibraryQueryImage } from '../services/libraryQuery/dataset';
import type { BoardQueryDataset, BoardQueryFrame } from '../services/boards/queryProtocol';
import { boardDirectory, boardImage } from './helpers/boardIntegrationFixtures';

it('measures 10k projected items and reuses source facets across layout changes', () => {
  const images = Array.from({ length: 10000 }, (_, index) => ({
    ...toLibraryQueryImage(boardImage(`${index}.png`, { models: [`Model ${index % 500}`], tags: [`Tag ${index % 20}`], rating: index % 5 + 1 })),
    generator: 'ComfyUI', loraNames: [`LoRA ${index % 200}`], gpuDevice: 'Synthetic GPU',
  }));
  const source: BoardQueryDataset = { images, references: {}, collections: {}, context: { visibleDirectories: [boardDirectory], safeMode: { enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: [] } } };
  const frame: BoardQueryFrame = { id: 'sample', source: { kind: 'library' }, criteria: normalizeLibraryQueryCriteria(), groupConstraints: [], layout: { kind: 'grid' } };
  const measurements: number[][] = [];
  for (let sample = 0; sample < 3; sample++) {
    const cache = createBoardEvaluationCache();
    const t0 = performance.now();
    const grid = evaluateBoardQueries(source, [frame], 1, 1, cache).sample;
    const t1 = performance.now();
    const groups = evaluateBoardQueries(source, [{ ...frame, layout: { kind: 'groups', groupBy: 'model', subgroupBy: 'lora' } }], 1, 2, cache).sample;
    const t2 = performance.now();
    const matrix = evaluateBoardQueries(source, [{ ...frame, layout: { kind: 'matrix', rows: 'model', columns: 'lora' } }], 1, 3, cache).sample;
    const t3 = performance.now();
    measurements.push([t1 - t0, t2 - t1, t3 - t2]);
    expect(grid.totalCount).toBe(10000);
    expect(groups.facets).toBe(grid.facets); expect(matrix.facets).toBe(grid.facets);
    expect(matrix.grouped?.kind).toBe('matrix');
    if (matrix.grouped?.kind === 'matrix') expect(Object.keys(matrix.grouped.cells).length).toBeLessThan(matrix.grouped.rows.length * matrix.grouped.columns.length);
  }
  const medians = [0, 1, 2].map(index => measurements.map(sample => sample[index]).sort((a, b) => a - b)[1].toFixed(1));
  console.info(`Canvas usability synthetic 10k / one frame: cold grid ${medians[0]} ms; cached groups ${medians[1]} ms; cached matrix ${medians[2]} ms (median of 3).`);
});
