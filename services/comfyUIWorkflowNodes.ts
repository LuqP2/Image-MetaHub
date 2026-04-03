import { type IndexedImage } from '../types';

type PromptNodeLike = {
  class_type?: unknown;
};

type WorkflowNodeLike = {
  type?: unknown;
};

type WorkflowLike = {
  nodes?: unknown;
};

const parseMaybeJson = <T>(value: unknown): T | null => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  return value && typeof value === 'object' ? (value as T) : null;
};

const normalizeNodeType = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const uniqueNodeTypes = (values: Array<unknown>): string[] => {
  const seen = new Set<string>();
  const nodeTypes: string[] = [];

  for (const value of values) {
    const normalized = normalizeNodeType(value);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    nodeTypes.push(normalized);
  }

  return nodeTypes;
};

const extractPromptNodeTypes = (prompt: unknown): string[] => {
  const parsed = parseMaybeJson<Record<string, PromptNodeLike>>(prompt);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }

  return uniqueNodeTypes(Object.values(parsed).map((node) => node?.class_type));
};

const extractWorkflowUiNodeTypes = (workflow: unknown): string[] => {
  const parsed = parseMaybeJson<WorkflowLike>(workflow);
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  const nodes = Array.isArray(parsed.nodes) ? (parsed.nodes as WorkflowNodeLike[]) : [];
  return uniqueNodeTypes(nodes.map((node) => node?.type));
};

export const extractWorkflowNodeTypes = (source: {
  workflow?: unknown;
  prompt?: unknown;
}): string[] => {
  const promptNodeTypes = extractPromptNodeTypes(source.prompt);
  if (promptNodeTypes.length > 0) {
    return promptNodeTypes;
  }

  return extractWorkflowUiNodeTypes(source.workflow);
};

export const extractWorkflowNodeTypesFromMetadata = (metadata: unknown): string[] => {
  if (!metadata || typeof metadata !== 'object') {
    return [];
  }

  const rawMetadata = metadata as Record<string, unknown>;
  const metaHubData =
    parseMaybeJson<Record<string, unknown>>(rawMetadata.imagemetahub_data) ||
    (rawMetadata.imagemetahub_data && typeof rawMetadata.imagemetahub_data === 'object'
      ? (rawMetadata.imagemetahub_data as Record<string, unknown>)
      : null);

  return extractWorkflowNodeTypes({
    workflow: metaHubData?.workflow ?? rawMetadata.workflow,
    prompt: metaHubData?.prompt_api ?? metaHubData?.prompt ?? rawMetadata.prompt,
  });
};

export const buildWorkflowNodeCatalog = (images: IndexedImage[]): Array<{ name: string; count: number }> => {
  const counts = new Map<string, { name: string; count: number }>();

  for (const image of images) {
    for (const nodeType of image.workflowNodes || []) {
      const key = nodeType.toLowerCase();
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { name: nodeType, count: 1 });
      }
    }
  }

  return Array.from(counts.values()).sort((left, right) => {
    if (left.count !== right.count) {
      return right.count - left.count;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'accent' });
  });
};

export const filterImagesByWorkflowNodes = (
  images: IndexedImage[],
  selectedNodeTypes: string[]
): IndexedImage[] => {
  if (selectedNodeTypes.length === 0) {
    return images.filter((image) => (image.workflowNodes?.length || 0) > 0);
  }

  const selected = new Set(selectedNodeTypes.map((value) => value.toLowerCase()));
  return images.filter((image) =>
    (image.workflowNodes || []).some((nodeType) => selected.has(nodeType.toLowerCase()))
  );
};
