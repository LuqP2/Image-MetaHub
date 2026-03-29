import { type ComfyUIWorkflow } from '../types';
import { type ComfyUIPromptGraph, type ComfyUIPromptNode, type ComfyWorkflowAnalysis } from './comfyUIWorkflowBuilder';

export type VisualWorkflowNodeCategory =
  | 'prompt'
  | 'sampler'
  | 'model'
  | 'lora'
  | 'image'
  | 'mask'
  | 'save'
  | 'timer'
  | 'generic';

export type VisualWorkflowFieldType = 'string' | 'number' | 'boolean';

export interface VisualWorkflowField {
  key: string;
  label: string;
  type: VisualWorkflowFieldType;
  value: string | number | boolean;
  editable: boolean;
  reasonDisabled?: string;
}

export interface VisualWorkflowNode {
  id: string;
  label: string;
  classType: string;
  category: VisualWorkflowNodeCategory;
  x: number;
  y: number;
  width: number;
  height: number;
  isEditable: boolean;
  fields: VisualWorkflowField[];
}

export interface VisualWorkflowEdge {
  from: string;
  to: string;
  label?: string;
  kind: 'connection';
}

export interface VisualWorkflowGraph {
  nodes: VisualWorkflowNode[];
  edges: VisualWorkflowEdge[];
  hasStoredLayout: boolean;
}

const AUTO_LAYOUT_X_GAP = 320;
const AUTO_LAYOUT_Y_GAP = 190;
const DEFAULT_NODE_WIDTH = 260;
const MIN_NODE_HEIGHT = 128;
const MIN_NODE_WIDTH = 220;

function sortNodeIds(nodeIds: string[]): string[] {
  return [...nodeIds].sort((left, right) => {
    const leftNumeric = Number(left);
    const rightNumeric = Number(right);
    if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) {
      return leftNumeric - rightNumeric;
    }
    return left.localeCompare(right);
  });
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getConnectionNodeId(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const [nodeId] = value;
  return typeof nodeId === 'string' ? nodeId : typeof nodeId === 'number' ? String(nodeId) : null;
}

function getNodeCategory(nodeId: string, node: ComfyUIPromptNode, analysis?: ComfyWorkflowAnalysis): VisualWorkflowNodeCategory {
  const classType = (node.class_type || '').toLowerCase();

  if (analysis?.positiveTargets.some((target) => target.nodeId === nodeId)
    || analysis?.negativeTargets.some((target) => target.nodeId === nodeId)
    || classType.includes('cliptextencode')) {
    return 'prompt';
  }

  if (analysis?.samplerTargets.includes(nodeId) || classType.includes('sampler')) {
    return 'sampler';
  }

  if (analysis?.loraTargets.some((target) => target.nodeId === nodeId) || classType.includes('lora')) {
    return 'lora';
  }

  if (analysis?.modelTargets.some((target) => target.nodeId === nodeId)) {
    return 'model';
  }

  if (analysis?.imageTargets.some((target) => target.nodeId === nodeId) || classType === 'loadimage') {
    return 'image';
  }

  if (analysis?.maskTargets.some((target) => target.nodeId === nodeId) || classType === 'loadimagemask') {
    return 'mask';
  }

  if (analysis?.saveNodeIds.includes(nodeId) || classType === 'metahubsavenode' || classType === 'saveimage') {
    return 'save';
  }

  if (analysis?.timerNodeIds.includes(nodeId) || classType === 'metahubtimernode') {
    return 'timer';
  }

  return 'generic';
}

function isEditableLiteralInput(
  category: VisualWorkflowNodeCategory,
  inputKey: string,
  value: unknown
): value is string | number | boolean {
  if (category === 'save' || category === 'timer') {
    return false;
  }

  if (Array.isArray(value) || value == null) {
    return false;
  }

  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return false;
  }

  if (inputKey === 'generation_time_override') {
    return false;
  }

  return true;
}

function getNodeFields(node: ComfyUIPromptNode, category: VisualWorkflowNodeCategory): VisualWorkflowField[] {
  const fields: VisualWorkflowField[] = [];

  for (const [inputKey, inputValue] of Object.entries(node.inputs || {})) {
    if (!isEditableLiteralInput(category, inputKey, inputValue)) {
      continue;
    }

    fields.push({
      key: inputKey,
      label: formatFieldLabel(inputKey),
      type: typeof inputValue === 'number' ? 'number' : typeof inputValue === 'boolean' ? 'boolean' : 'string',
      value: inputValue,
      editable: true,
    });
  }

  return fields;
}

function getNodeLabel(nodeId: string, node: ComfyUIPromptNode, workflow?: ComfyUIWorkflow | null): string {
  const workflowNode = workflow?.nodes?.find((entry) => String(entry.id) === nodeId);
  return node._meta?.title || workflowNode?.title || node.class_type || `Node ${nodeId}`;
}

function getNodeDimensions(
  nodeId: string,
  workflow: ComfyUIWorkflow | null | undefined,
  fields: VisualWorkflowField[]
): { width: number; height: number } {
  const workflowNode = workflow?.nodes?.find((entry) => String(entry.id) === nodeId);
  const storedSize = workflowNode?.size;
  const storedWidth = storedSize?.[0];
  const storedHeight = storedSize?.[1];
  const previewHeight = Math.max(MIN_NODE_HEIGHT, 88 + Math.min(fields.length, 3) * 38);

  return {
    width: typeof storedWidth === 'number' ? Math.max(MIN_NODE_WIDTH, storedWidth) : DEFAULT_NODE_WIDTH,
    height: typeof storedHeight === 'number' ? Math.max(previewHeight, storedHeight) : previewHeight,
  };
}

function buildAutoLayout(prompt: ComfyUIPromptGraph, edges: VisualWorkflowEdge[]): Map<string, { x: number; y: number }> {
  const nodeIds = sortNodeIds(Object.keys(prompt));
  const upstreamMap = new Map<string, string[]>();

  for (const nodeId of nodeIds) {
    upstreamMap.set(nodeId, []);
  }

  for (const edge of edges) {
    upstreamMap.set(edge.to, [...(upstreamMap.get(edge.to) || []), edge.from]);
  }

  const depthMemo = new Map<string, number>();
  const depthStack = new Set<string>();

  const getDepth = (nodeId: string): number => {
    if (depthMemo.has(nodeId)) {
      return depthMemo.get(nodeId)!;
    }

    if (depthStack.has(nodeId)) {
      return 0;
    }

    depthStack.add(nodeId);
    const upstream = upstreamMap.get(nodeId) || [];
    const depth = upstream.length === 0 ? 0 : Math.max(...upstream.map((entry) => getDepth(entry) + 1));
    depthStack.delete(nodeId);
    depthMemo.set(nodeId, depth);
    return depth;
  };

  const columns = new Map<number, string[]>();
  for (const nodeId of nodeIds) {
    const depth = getDepth(nodeId);
    columns.set(depth, [...(columns.get(depth) || []), nodeId]);
  }

  const layout = new Map<string, { x: number; y: number }>();
  for (const [depth, columnNodeIds] of columns.entries()) {
    sortNodeIds(columnNodeIds).forEach((nodeId, index) => {
      layout.set(nodeId, {
        x: depth * AUTO_LAYOUT_X_GAP,
        y: index * AUTO_LAYOUT_Y_GAP,
      });
    });
  }

  return layout;
}

export function buildVisualWorkflowGraph(
  prompt: ComfyUIPromptGraph | null | undefined,
  workflow?: ComfyUIWorkflow | null,
  analysis?: ComfyWorkflowAnalysis | null
): VisualWorkflowGraph | null {
  if (!prompt) {
    return null;
  }

  const edges: VisualWorkflowEdge[] = [];
  for (const [nodeId, node] of Object.entries(prompt)) {
    for (const [inputKey, inputValue] of Object.entries(node.inputs || {})) {
      const upstreamNodeId = getConnectionNodeId(inputValue);
      if (!upstreamNodeId) {
        continue;
      }

      edges.push({
        from: upstreamNodeId,
        to: nodeId,
        label: inputKey,
        kind: 'connection',
      });
    }
  }

  const storedLayout = new Map<string, { x: number; y: number }>();
  for (const node of workflow?.nodes || []) {
    if (Array.isArray(node.pos) && node.pos.length === 2) {
      storedLayout.set(String(node.id), { x: node.pos[0], y: node.pos[1] });
    }
  }
  const autoLayout = buildAutoLayout(prompt, edges);

  const nodes = sortNodeIds(Object.keys(prompt)).map((nodeId) => {
    const node = prompt[nodeId];
    const category = getNodeCategory(nodeId, node, analysis || undefined);
    const fields = getNodeFields(node, category);
    const position = storedLayout.get(nodeId) || autoLayout.get(nodeId) || { x: 0, y: 0 };
    const dimensions = getNodeDimensions(nodeId, workflow, fields);
    return {
      id: nodeId,
      label: getNodeLabel(nodeId, node, workflow),
      classType: node.class_type,
      category,
      x: position.x,
      y: position.y,
      width: dimensions.width,
      height: dimensions.height,
      isEditable: fields.length > 0,
      fields,
    } satisfies VisualWorkflowNode;
  });

  return {
    nodes,
    edges,
    hasStoredLayout: storedLayout.size > 0,
  };
}
