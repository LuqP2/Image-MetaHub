const fail = message => { const error = new Error(message); error.code = 'BOARD_INVALID_DOCUMENT'; throw error; };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const choice = (value, values) => { if (!values.includes(value)) fail('Invalid query enum.'); return value; };
const text = value => { if (typeof value !== 'string') fail('Invalid query string.'); return value; };
const identifier = value => { if (!text(value).trim()) fail('Empty query reference.'); return value; };
const finite = value => { if (typeof value !== 'number' || !Number.isFinite(value)) fail('Invalid query number.'); return value; };
const boolean = value => { if (typeof value !== 'boolean') fail('Invalid query boolean.'); return value; };
const list = value => { if (!Array.isArray(value)) fail('Invalid query array.'); return value; };
export const groupingDimensions = ['model', 'lora', 'sampler', 'scheduler', 'seed', 'dimensions', 'generator', 'rating', 'favorite', 'tag', 'autoTag', 'date', 'session', 'folder', 'collection', 'cluster'];
const dimension = value => choice(value, groupingDimensions);

export function normalizeQueryCriteria(input) {
  if (!record(input)) fail('Query criteria are required.');
  const result = {};
  for (const key of ['selectedModels', 'excludedModels', 'selectedLoras', 'excludedLoras', 'selectedSamplers', 'excludedSamplers', 'selectedSchedulers', 'excludedSchedulers', 'selectedGenerators', 'excludedGenerators', 'selectedGpuDevices', 'excludedGpuDevices', 'selectedTags', 'excludedTags', 'selectedAutoTags', 'excludedAutoTags', 'selectedFolders', 'excludedFolders']) result[key] = [...new Set(list(input[key] ?? []).map(text))];
  result.searchQuery = text(input.searchQuery ?? '');
  result.selectedTagsMatchMode = choice(input.selectedTagsMatchMode ?? 'any', ['any', 'all']);
  result.favoriteFilterMode = choice(input.favoriteFilterMode ?? 'neutral', ['neutral', 'include', 'exclude']);
  result.selectedRatings = [...new Set(list(input.selectedRatings ?? []).map(value => choice(value, [1, 2, 3, 4, 5])))];
  result.sortOrder = choice(input.sortOrder ?? 'date-desc', ['asc', 'desc', 'date-asc', 'date-desc', 'random']);
  result.randomSeed = finite(input.randomSeed ?? 42);
  result.includeSubfolders = boolean(input.includeSubfolders ?? true);
  const advanced = input.advancedFilters ?? {};
  if (!record(advanced)) fail('Invalid advanced filters.');
  result.advancedFilters = {};
  for (const key of ['steps', 'cfg', 'generationTimeMs', 'stepsPerSecond', 'vramPeakMb']) {
    if (advanced[key] === undefined) continue;
    const range = advanced[key];
    if (!record(range)) fail('Invalid numeric range.');
    const normalized = {};
    for (const bound of ['min', 'max']) if (range[bound] !== undefined) normalized[bound] = range[bound] === null ? null : finite(range[bound]);
    if (range.maxExclusive !== undefined) normalized.maxExclusive = boolean(range.maxExclusive);
    if (normalized.min != null && normalized.max != null && normalized.min > normalized.max) fail('Reversed numeric range.');
    result.advancedFilters[key] = normalized;
  }
  if (advanced.dimension !== undefined) result.advancedFilters.dimension = text(advanced.dimension);
  if (advanced.date !== undefined) {
    if (!record(advanced.date)) fail('Invalid date range.');
    result.advancedFilters.date = {};
    for (const bound of ['from', 'to']) if (advanced.date[bound] !== undefined) {
      const value = advanced.date[bound];
      if (value !== null && (typeof value !== 'string' || (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)))) fail('Invalid date.');
      result.advancedFilters.date[bound] = value;
    }
  }
  for (const [key, values] of [['generationModes', ['txt2img', 'img2img']], ['mediaTypes', ['image', 'video', 'audio', 'model3d']]]) if (advanced[key] !== undefined) result.advancedFilters[key] = [...new Set(list(advanced[key]).map(value => choice(value, values)))];
  if (advanced.telemetryState !== undefined) result.advancedFilters.telemetryState = choice(advanced.telemetryState, ['present', 'missing']);
  if (advanced.hasVerifiedTelemetry !== undefined) result.advancedFilters.hasVerifiedTelemetry = boolean(advanced.hasVerifiedTelemetry);
  return result;
}

export function normalizeGroupConstraints(input) {
  return list(input).map(value => {
    if (!record(value)) fail('Invalid group constraint.');
    const dim = dimension(value.dimension);
    if (value.kind === 'missing') return { kind: 'missing', dimension: dim };
    if (value.kind === 'exact') return { kind: 'exact', dimension: dim, value: text(value.value) };
    if (value.kind === 'session' && dim === 'session') {
      const start = finite(value.start), endExclusive = finite(value.endExclusive);
      if (start >= endExclusive) fail('Invalid session interval.');
      return { kind: 'session', dimension: dim, start, endExclusive };
    }
    return fail('Unknown group constraint.');
  });
}

export function normalizeQueryLayout(value) {
  if (!record(value)) fail('Invalid query layout.');
  if (value.kind === 'grid') return { kind: 'grid' };
  if (value.kind === 'groups') return { kind: 'groups', groupBy: dimension(value.groupBy), subgroupBy: value.subgroupBy === null ? null : dimension(value.subgroupBy) };
  if (value.kind === 'matrix') {
    const rows = dimension(value.rows), columns = dimension(value.columns);
    if (rows === columns) fail('Matrix axes must differ.');
    return { kind: 'matrix', rows, columns };
  }
  return fail('Unknown query layout.');
}

export function normalizeSetExpression(value, normalizeReference, budget = { count: 0 }, depth = 0) {
  if (++budget.count > 10000 || depth > 64) fail('Query expression limit exceeded.');
  if (!record(value)) fail('Invalid set expression.');
  const child = expression => normalizeSetExpression(expression, normalizeReference, budget, depth + 1);
  switch (value.kind) {
    case 'library': return { kind: 'library' };
    case 'collection': return { kind: 'collection', collectionId: identifier(value.collectionId) };
    case 'frame': return { kind: 'frame', frameId: identifier(value.frameId) };
    case 'snapshot': return { kind: 'snapshot', references: list(value.references).map(normalizeReference) };
    case 'intersection': {
      const inputs = list(value.inputs);
      if (inputs.length < 2) fail('Intersection needs at least two sources.');
      return { kind: 'intersection', inputs: inputs.map(child) };
    }
    case 'difference': return { kind: 'difference', left: child(value.left), right: child(value.right) };
    case 'query': return { kind: 'query', source: child(value.source), criteria: normalizeQueryCriteria(value.criteria), groupConstraints: normalizeGroupConstraints(value.groupConstraints) };
    default: return fail('Unknown set expression.');
  }
}

export function mapSetExpression(source, transform) {
  let value = source;
  if (source.kind === 'query') value = { ...source, source: mapSetExpression(source.source, transform) };
  if (source.kind === 'intersection') value = { ...source, inputs: source.inputs.map(input => mapSetExpression(input, transform)) };
  if (source.kind === 'difference') value = { ...source, left: mapSetExpression(source.left, transform), right: mapSetExpression(source.right, transform) };
  return transform(value);
}

export function validateQueryGraph(objects) {
  const byId = new Map(objects.map(object => [object.id, object]));
  const complete = new Set(), active = new Set();
  const visit = (id, depth = 0) => {
    if (depth > 64 || active.has(id)) fail('Cyclic or excessively deep frame dependency.');
    if (complete.has(id)) return;
    const object = byId.get(id);
    if (!object) return; // Missing sources remain reconnectable user documents.
    if (object.type !== 'smart-frame') fail('Query source must point to a Smart Frame.');
    active.add(id);
    mapSetExpression(object.source, source => { if (source.kind === 'frame') visit(source.frameId, depth + 1); return source; });
    active.delete(id); complete.add(id);
  };
  for (const object of objects) if (object.type === 'smart-frame') visit(object.id);
}
