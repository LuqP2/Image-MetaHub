import type { BoardQueryDataset, BoardQueryRequest, BoardQueryResponse } from '../boards/queryProtocol';
import { evaluateBoardQueries, createBoardEvaluationCache } from '../boards/queryEvaluator';

let cache = createBoardEvaluationCache();
let dataset: BoardQueryDataset | null = null;
let revision = 0;
self.onmessage = (event: MessageEvent<BoardQueryRequest>) => {
  const message = event.data;
  if (message.type === 'syncDataset') { dataset = message.dataset; revision = message.revision; return; }
  if (message.type === 'disposeBoard') { dataset = null; cache = createBoardEvaluationCache(); return; }
  let response: BoardQueryResponse;
  try {
    if (!dataset || revision !== message.datasetRevision) throw new Error('Query dataset is out of sync.');
    response = { type: 'boardResults', boardId: message.boardId, datasetRevision: revision, queryRevision: message.queryRevision,
      results: evaluateBoardQueries(dataset, message.frames, revision, message.queryRevision, cache) };
  } catch (error) {
    response = { type: 'error', boardId: message.boardId, datasetRevision: message.datasetRevision, queryRevision: message.queryRevision, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
