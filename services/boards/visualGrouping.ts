export interface VisualVector { imageId: string; vector: Float32Array }
export interface VisualGroupingResult { groups: string[][]; isolated: string[] }

/** Agglomerative complete linkage using reciprocal nearest-neighbor chains.
 * Cluster similarities are computed on demand; only one nearest-neighbor
 * record per cluster is cached, never a quadratic distance matrix.
 */
export async function groupVisualVectors(input: VisualVector[], threshold: number, progress: (done: number, total: number) => void = () => {}, signal?: AbortSignal): Promise<VisualGroupingResult> {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Invalid similarity threshold.');
  const vectors = [...input].sort((a, b) => a.imageId.localeCompare(b.imageId));
  const dim = vectors[0]?.vector.length ?? 0;
  const normalized = vectors.map(item => {
    if (!dim || item.vector.length !== dim || item.vector.some(value => !Number.isFinite(value))) throw new Error('Invalid visual vector.');
    const norm = Math.sqrt(item.vector.reduce((sum, value) => sum + value * value, 0));
    if (!norm) throw new Error('Empty visual vector.');
    return Float32Array.from(item.vector, value => value / norm);
  });
  const clusters = new Map(vectors.map((_, index) => [index, [index]]));
  const nearestCache = new Map<number, { id: number; score: number }>();
  const completed: number[][] = [];
  let comparisons = 0, done = 0;
  const similarity = async (left: number[], right: number[]) => {
    let minimum = 1;
    for (const i of left) for (const j of right) {
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += normalized[i][d] * normalized[j][d];
      minimum = Math.min(minimum, dot);
      if (++comparisons % 4096 === 0) {
        signal?.throwIfAborted();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      // Below the cut, the exact distance cannot affect a merge.
      if (minimum + 1e-7 < threshold) return minimum;
    }
    return minimum;
  };
  const invalidate = (removed: number[]) => {
    for (const [id, nearest] of nearestCache) if (removed.includes(id) || removed.includes(nearest.id)) nearestCache.delete(id);
  };
  while (clusters.size) {
    signal?.throwIfAborted();
    const chain: number[] = [Math.min(...clusters.keys())];
    while (chain.length) {
      signal?.throwIfAborted();
      const last = chain[chain.length - 1], previous = chain[chain.length - 2];
      let nearest = nearestCache.get(last);
      if (!nearest) {
        nearest = { id: -1, score: threshold - 1e-7 };
        const candidates = [...clusters.keys()].filter(id => id !== last).sort((a, b) => Number(b === previous) - Number(a === previous) || a - b);
        for (const id of candidates) {
          const score = await similarity(clusters.get(last)!, clusters.get(id)!);
          if (score > nearest.score) nearest = { id, score };
          // Cosine cannot exceed one; an exact match is already nearest.
          if (nearest.score >= 1 - 1e-7) break;
        }
        nearestCache.set(last, nearest);
      } else if (previous !== undefined && nearest.id !== previous) {
        // Prefer the predecessor on ties, including when reusing a cache entry.
        const score = await similarity(clusters.get(last)!, clusters.get(previous)!);
        if (score + 1e-7 >= threshold && score >= nearest.score) nearest = { id: previous, score };
      }
      if (nearest.id < 0) {
        const members = clusters.get(last)!;
        completed.push(members); clusters.delete(last); invalidate([last]);
        done += members.length; progress(done, vectors.length); break;
      }
      if (nearest.id === previous) {
        const members = [...clusters.get(last)!, ...clusters.get(previous)!].sort((a, b) => a - b);
        clusters.delete(last); clusters.delete(previous); invalidate([last, previous]);
        clusters.set(members[0], members);
        // Complete linkage cannot increase similarity to an untouched cluster;
        // its cached nearest remains valid unless that neighbor was merged.
        break;
      }
      chain.push(nearest.id);
    }
  }
  const groups = completed.filter(group => group.length > 1).sort((a, b) => a[0] - b[0]).map(group => group.map(index => vectors[index].imageId));
  return { groups, isolated: completed.filter(group => group.length === 1).map(group => vectors[group[0]].imageId).sort() };
}
