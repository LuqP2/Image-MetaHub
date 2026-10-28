import { createBoardDocument } from '../services/boards/document.mjs';
import { createSmartFrame, branchSmartFrame, duplicateSmartFrameQuery } from '../services/boards/smartFrameOperations';
import { addConnection } from '../services/boards/operations';
import { describe, expect, it } from 'vitest';
import { boardToFlow, flowGeometryUpdates } from '../services/boards/reactFlowAdapter';
import { createFrame } from '../services/boards/operations';
import { boardWithTexts } from './helpers/boardFixtures';

describe('board React Flow boundary', () => {
  it('keeps persistent coordinates absolute and converts selected children with updated parent coordinates', () => {
    const original = boardWithTexts();
    const document = createFrame(original, original.objects.map(object => object.id));
    const { nodes } = boardToFlow(document, [original.objects[0].id], [], true);
    const parent = nodes[0];
    const child = nodes[1];
    expect(parent.type).toBe('frame'); expect(child.parentId).toBe(parent.id);
    expect(child.position.x + parent.position.x).toBe(document.objects[1].x);
    const changed = nodes.map(node => node.id === parent.id ? { ...node, position: { x: node.position.x + 100, y: node.position.y + 50 } } : node);
    const updates = flowGeometryUpdates(changed, [{ type: 'position', id: child.id, position: child.position, dragging: true }]);
    expect(updates[0]).toMatchObject({ x: document.objects[1].x + 100, y: document.objects[1].y + 50 });
    expect(flowGeometryUpdates(nodes, [{ type: 'dimensions', id: child.id, dimensions: { width: 300, height: 300 } }])).toEqual([]);
  });
});

it('derives immutable dependency edges without persisting them or changing manual connections', () => {
  let document = createSmartFrame(createBoardDocument(), { id: 'parent' });
  document = branchSmartFrame(document, 'parent');
  const childId = document.objects[1].id;
  document = addConnection(document, { sourceObjectId: 'parent', targetObjectId: childId, sourceSide: 'bottom', targetSide: 'top', label: 'manual', color: '#ffffff' });
  const before = JSON.stringify(document);
  const { edges } = boardToFlow(document, [], [], false);
  expect(edges.filter(edge => edge.type === 'manual')).toHaveLength(1);
  const dependency = edges.find(edge => edge.type === 'query')!;
  expect(dependency).toMatchObject({ source: 'parent', target: childId, selectable: false, deletable: false, reconnectable: false });
  expect(boardToFlow(document, [], [], true).edges.find(edge => edge.type === 'query')?.id).toBe(dependency.id);
  expect(JSON.stringify(document)).toBe(before);
  expect(document.connections).toHaveLength(1);
  const duplicate = duplicateSmartFrameQuery(document, childId);
  expect(boardToFlow(duplicate, [], [], true).edges.filter(edge => edge.type === 'query')).toHaveLength(1);
});
