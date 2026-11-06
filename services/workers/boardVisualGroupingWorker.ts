import { groupVisualVectors, type VisualVector } from '../boards/visualGrouping';

self.onmessage = async (event: MessageEvent<{ vectors: VisualVector[]; threshold: number }>) => {
  try {
    const result = await groupVisualVectors(event.data.vectors, event.data.threshold, (done, total) => self.postMessage({ type: 'progress', done, total }));
    self.postMessage({ type: 'result', result });
  } catch (error) { self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) }); }
};
