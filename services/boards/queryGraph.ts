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

export function frameDependencies(source: import('./queryTypes').BoardSetExpression): string[] {
  const ids = new Set<string>();
  mapSetExpression(source, expression => { if (expression.kind === 'frame') ids.add(expression.frameId); return expression; });
  return [...ids];
}

export function reconnectableFrames(frames: BoardQueryFrame[], targetId: string): BoardQueryFrame[] {
  const byId = new Map(frames.map(frame => [frame.id, frame]));
  const dependsOnTarget = (id: string, visited: Set<string>): boolean => {
    if (id === targetId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    const frame = byId.get(id);
    return !!frame && frameDependencies(frame.source).some(parent => dependsOnTarget(parent, visited));
  };
  return frames.filter(frame => !dependsOnTarget(frame.id, new Set()));
}
