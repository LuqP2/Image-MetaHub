import { findDuplicates } from '../promptLibrary/duplicates';
self.onmessage = (event) => {
  const { requestId, item, candidates, similar } = event.data;
  self.postMessage({ requestId, matches: findDuplicates(item, candidates, similar) });
};
