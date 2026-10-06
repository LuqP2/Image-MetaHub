import type { ModelInspectorItem, ModelInspectorSnapshot } from './types';

const containsLocation = (items: ModelInspectorItem[], id: string | null): id is string =>
  Boolean(id && items.some((item) => item.location.id === id));

export function createModelInspectorSnapshot(
  items: ModelInspectorItem[],
  selectedId: string | null,
  revision = 1,
): ModelInspectorSnapshot {
  return {
    revision,
    items,
    selectedId: containsLocation(items, selectedId) ? selectedId : items[0]?.location.id ?? null,
    followSelection: true,
    isAlwaysOnTop: false,
  };
}

export function replaceModelInspectorCollection(
  current: ModelInspectorSnapshot,
  items: ModelInspectorItem[],
): ModelInspectorSnapshot {
  const selectedId = containsLocation(items, current.selectedId)
    ? current.selectedId
    : items[0]?.location.id ?? null;
  return { ...current, revision: current.revision + 1, items, selectedId };
}

export function applyFollowedModelSelection(
  current: ModelInspectorSnapshot,
  selectedId: string | null,
): ModelInspectorSnapshot {
  if (!current.followSelection || !containsLocation(current.items, selectedId) || current.selectedId === selectedId) {
    return current;
  }
  return { ...current, revision: current.revision + 1, selectedId };
}

export function setModelInspectorSelection(
  current: ModelInspectorSnapshot,
  selectedId: string,
): ModelInspectorSnapshot {
  if (!containsLocation(current.items, selectedId) || current.selectedId === selectedId) return current;
  return { ...current, revision: current.revision + 1, selectedId };
}

export function navigateModelInspector(
  current: ModelInspectorSnapshot,
  direction: 'previous' | 'next',
): ModelInspectorSnapshot {
  if (!current.items.length) return current;
  const currentIndex = current.items.findIndex((item) => item.location.id === current.selectedId);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = direction === 'next'
    ? Math.min(current.items.length - 1, safeIndex + 1)
    : Math.max(0, safeIndex - 1);
  return setModelInspectorSelection(current, current.items[nextIndex].location.id);
}

export function setModelInspectorFollowSelection(
  current: ModelInspectorSnapshot,
  followSelection: boolean,
): ModelInspectorSnapshot {
  if (current.followSelection === followSelection) return current;
  return { ...current, revision: current.revision + 1, followSelection };
}

export function replaceModelInspectorLocation(
  current: ModelInspectorSnapshot,
  locationId: string,
  update: ModelInspectorItem,
): ModelInspectorSnapshot {
  const index = current.items.findIndex((item) => item.location.id === locationId);
  if (index < 0 || update.location.id !== locationId) return current;
  const items = [...current.items];
  items[index] = update;
  return { ...current, revision: current.revision + 1, items };
}
