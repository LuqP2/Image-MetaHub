import type { BoardQueryFrame } from './queryProtocol';
import type { BoardQueryDataset, BoardQueryRequest, BoardQueryResponse, BoardQueryResult } from './queryProtocol';

export interface BoardQueryWorkerPort {
  postMessage(message: BoardQueryRequest): void;
  onmessage: ((event: MessageEvent<BoardQueryResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}
export function createBoardQueryRuntime(boardId: string, createWorker: () => BoardQueryWorkerPort, publish: (results: Record<string, BoardQueryResult>) => void) {
  let worker: BoardQueryWorkerPort | null = null;
  let dataset: BoardQueryDataset | null = null;
  let datasetRevision = 0, queryRevision = 0;
  let frames: BoardQueryFrame[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const pending = (error?: string) => publish(Object.fromEntries(frames.map(frame => [frame.id, {
    frameId: frame.id, datasetRevision, queryRevision, imageIds: [], totalCount: 0, unavailableReferences: 0,
    status: error ? 'error' : 'loading', error,
  } satisfies BoardQueryResult])));
  const start = () => {
    try {
      const instance = createWorker();
      worker = instance;
      worker.onmessage = event => {
        const message = event.data;
        if (disposed || worker !== instance || message.boardId !== boardId || message.datasetRevision !== datasetRevision || message.queryRevision !== queryRevision) return;
        if (message.type === 'boardResults') publish(message.results); else pending(message.error);
      };
      worker.onerror = event => { if (disposed || worker !== instance) return; pending(event.message || 'Query worker failed.'); instance.terminate(); worker = null; };
      if (dataset) worker.postMessage({ type: 'syncDataset', revision: datasetRevision, dataset });
    } catch (error) { worker = null; pending(String(error)); }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (disposed || !dataset) return;
      if (!worker) start();
      worker?.postMessage({ type: 'evaluateBoard', boardId, datasetRevision, queryRevision, frames });
    }, 150);
  };
  return {
    syncDataset(value: BoardQueryDataset) {
      if (disposed) return;
      dataset = value; datasetRevision++; queryRevision++; pending();
      if (worker) worker.postMessage({ type: 'syncDataset', revision: datasetRevision, dataset });
      schedule();
    },
    evaluate(value: BoardQueryFrame[]) {
      if (disposed) return;
      frames = value; queryRevision++; pending(); schedule();
    },
    pause() { dataset = null; datasetRevision++; queryRevision++; clearTimeout(timer); pending(); },
    retry() { if (!disposed) { worker?.terminate(); worker = null; queryRevision++; pending(); schedule(); } },
    dispose() { disposed = true; clearTimeout(timer); worker?.terminate(); worker = null; dataset = null; frames = []; },
  };
}
