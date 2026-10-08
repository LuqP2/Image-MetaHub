export function huggingFaceConfig(binding) {
  return { trackedRevision: binding.trackedRevision ?? 'main', watchedDirectory: binding.watchedDirectory ?? binding.filePath.split('/').slice(0, -1).join('/'), recursive: binding.recursive ?? false, monitoringEnabled: binding.monitoringEnabled ?? false };
}
export function huggingFaceWatchId(binding) {
  const config = huggingFaceConfig(binding);
  return `hf:${JSON.stringify([binding.repoId, binding.filePath, config.trackedRevision, config.watchedDirectory, config.recursive])}`;
}
export function huggingFaceQueryKey(binding) {
  const config = huggingFaceConfig(binding);
  return JSON.stringify([binding.repoId, config.trackedRevision, config.watchedDirectory, config.recursive]);
}
