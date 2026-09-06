import path from 'node:path';

export const PROVENANCE_DIRECTORY_NAME = 'provenance';
export const PROVENANCE_DATABASE_NAME = 'catalog.sqlite';

export function resolveProvenanceCatalogPath(userDataPath) {
  return path.join(userDataPath, PROVENANCE_DIRECTORY_NAME, PROVENANCE_DATABASE_NAME);
}
