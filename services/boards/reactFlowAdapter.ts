import type { Edge, Node, NodeChange } from '@xyflow/react';
import type { BoardDocument, BoardObject } from './types';
import type { BoardObjectUpdate } from './operations';

export type BoardFlowNode = Node<{ object: BoardObject }>;
export function boardToFlow(document: BoardDocument, selectedObjectIds: string[], selectedConnectionIds: string[], editable: boolean) {
  const frames = new Map(document.objects.filter(object => object.type === 'frame').map(object => [object.id, object]));
  const nodes: BoardFlowNode[] = [...document.objects].sort((a, b) => Number(b.type === 'frame') - Number(a.type === 'frame')).map(object => {
    const parent = object.frameId ? frames.get(object.frameId) : undefined;
    return {
      id: object.id, type: object.type, data: { object },
      parentId: parent?.id, position: { x: object.x - (parent?.x ?? 0), y: object.y - (parent?.y ?? 0) },
      style: { width: object.width, height: object.height }, width: object.width, height: object.height,
      zIndex: object.zIndex, selected: selectedObjectIds.includes(object.id), draggable: editable, connectable: editable,
      dragHandle: object.type === 'frame' ? '.board-frame-title' : undefined,
    };
  });
  const edges: Edge[] = document.connections.map(connection => ({
    id: connection.id, type: 'manual', source: connection.sourceObjectId, target: connection.targetObjectId,
    sourceHandle: connection.sourceSide, targetHandle: connection.targetSide,
    label: connection.label, data: { color: connection.color }, selected: selectedConnectionIds.includes(connection.id),
    zIndex: 1000,
  }));
  return { nodes, edges };
}

export function flowGeometryUpdates(nodes: BoardFlowNode[], changes: NodeChange<BoardFlowNode>[]): BoardObjectUpdate[] {
  const changedIds = new Set(changes.flatMap(change => change.type === 'position' || (change.type === 'dimensions' && change.resizing !== undefined) ? [change.id] : []));
  const byId = new Map(nodes.map(node => [node.id, node]));
  return nodes.filter(node => changedIds.has(node.id)).map(node => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    return { id: node.id, x: node.position.x + (parent?.position.x ?? 0), y: node.position.y + (parent?.position.y ?? 0),
      width: node.width ?? node.data.object.width, height: node.height ?? node.data.object.height,
    };
  });
}
