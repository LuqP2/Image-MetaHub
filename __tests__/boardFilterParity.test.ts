import { expect, it } from 'vitest';
import { toLibraryQueryImage, toLazyLibraryQueryImage } from '../services/libraryQuery/dataset';
import { normalizeLibraryQueryCriteria } from '../services/libraryQuery/criteria';
import { executeLibraryQuery } from '../services/libraryQuery/execute';
import { createBoardDocument, normalizeBoardDocument } from '../services/boards/document.mjs';
import { createSmartFrame } from '../services/boards/smartFrameOperations';
import { evaluateBoardQueries } from '../services/boards/queryEvaluator';
import { boardImage, boardDirectory } from './helpers/boardIntegrationFixtures';
import type { BoardSmartFrameObject } from '../services/boards/queryTypes';

it('matches the Library for checkpoint, LoRA, case-insensitive OR nodes and rating, with dynamic facets', () => {
  const images = [
    { ...boardImage('a.png'), models: ['Flux'], loras: ['Style'], workflowNodes: ['VAELoader'], rating: 4 as const },
    { ...boardImage('b.png'), models: ['Flux'], loras: ['Style'], workflowNodes: ['Other'], rating: 4 as const },
    { ...boardImage('c.png'), models: ['SDXL'], loras: ['Style'], workflowNodes: ['VAELoader'], rating: 4 as const },
  ];
  const context = { visibleDirectories: [{ id: boardDirectory.id, path: boardDirectory.path }], safeMode: { enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: [] } };
  const criteria = normalizeLibraryQueryCriteria({ selectedModels: ['Flux'], selectedLoras: ['Style'], selectedNodes: ['vaeloader', 'Absent'], selectedRatings: [4] });
  const library = executeLibraryQuery(images.map(toLibraryQueryImage), criteria, context);
  const lazy = executeLibraryQuery(images.map(toLazyLibraryQueryImage), criteria, context);
  expect(library.imageIds).toEqual([images[0].id]);
  expect(lazy.imageIds).toEqual(library.imageIds);
  const document = createSmartFrame(createBoardDocument(), { id: 'frame', criteria });
  const result = evaluateBoardQueries({ images: images.map(toLibraryQueryImage), context, collections: {}, references: {} }, document.objects as BoardSmartFrameObject[], 1, 1).frame;
  expect(result.imageIds).toEqual(library.imageIds);
  expect(result.facets?.sourceCounts?.Models).toEqual([['Flux', 1]]);
  expect(result.facets?.nodeFacetCounts).toEqual([['VAELoader', 1]]);
  expect(normalizeBoardDocument(document).objects).toEqual(document.objects);
});

it('defaults missing node criteria in saved queries to an empty list', () => {
  const document = createSmartFrame(createBoardDocument(), { id: 'frame' });
  const frame = document.objects[0] as BoardSmartFrameObject;
  delete frame.criteria.selectedNodes;
  const normalized = normalizeBoardDocument({ ...document, schemaVersion: 3 });
  expect((normalized.objects[0] as BoardSmartFrameObject).criteria.selectedNodes).toEqual([]);
});
