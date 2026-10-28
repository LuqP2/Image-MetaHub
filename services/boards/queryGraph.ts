import type { BoardQueryFrame } from './queryProtocol';
import { mapSetExpression, validateQueryGraph } from './queryDocument.mjs';

export function orderQueryFrames(frames: BoardQueryFrame[]): BoardQueryFrame[] {
  validateQueryGraph(frames);
  const byId = new Map(frames.map(frame => [frame.id, frame]));
  const visited = new Set<string>();
  const ordered: BoardQueryFrame[] = [];
  const visit = (frame: BoardQueryFrame) => {
    if (visited.has(frame.id)) return;
    visited.add(frame.id);
    mapSetExpression(frame.source, source => {
      if (source.kind === 'frame') { const parent = byId.get(source.frameId); if (parent) visit(parent); }
      return source;
    });
    ordered.push(frame);
  };
  frames.forEach(visit);
  return ordered;
}
