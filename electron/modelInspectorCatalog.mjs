// Inspector can edit a copy only when its byte identity belongs to a displayed model.
export function isInspectorHuggingFaceLocation(snapshot, catalog, locationId) {
  const location = catalog?.locations.find((entry) => entry.id === locationId);
  return Boolean(location && snapshot?.items.some((item) => item.location.id === locationId || (location.sha256 && item.location.sha256?.toLowerCase() === location.sha256.toLowerCase())));
}

// Preserve the selected logical model when its primary physical copy is removed.
export function reconcileModelInspectorCatalog(snapshot, state) {
  const locations = new Map(state.catalog.locations.map((location) => [location.id, location]));
  const byHash = new Map();
  for (const location of state.catalog.locations) if (location.sha256 && !byHash.has(location.sha256.toLowerCase())) byHash.set(location.sha256.toLowerCase(), location);
  const items = new Map();
  let selectedId = null;
  for (const item of snapshot.items) {
    const location = locations.get(item.location.id) ?? (item.location.sha256 ? byHash.get(item.location.sha256.toLowerCase()) : undefined);
    if (!location) continue;
    const identity = location.sha256 ? `sha256:${location.sha256.toLowerCase()}` : `location:${location.id}`;
    items.set(location.id, { location, localMetadata: state.localMetadata[identity] ?? state.localMetadata[`location:${location.id}`], usage: state.usage?.[identity] });
    if (item.location.id === snapshot.selectedId) selectedId = location.id;
  }
  return { ...snapshot, items: [...items.values()], selectedId: selectedId ?? items.keys().next().value ?? null };
}
