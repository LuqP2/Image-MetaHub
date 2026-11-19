import { groupingLabels } from '../../services/boards/grouping';
import type { BoardGroupingDimension } from '../../services/boards/queryTypes';
import type { MessageKey, Translate } from '../../i18n/useTranslation';

export function getBoardDisplayName(name: string): string {
  return name.split(/[\\/]/).filter(Boolean).pop() || name;
}

const mediaKeys: Record<string, MessageKey> = { image: 'canvas.imageMedia', video: 'canvas.videoMedia', audio: 'canvas.audioMedia', model3d: 'canvas.modelMedia' };
const metadataKeys: Record<string, MessageKey> = { model: 'librarySearch.model', loras: 'comparison.loras', seed: 'libraryGallery.seed', dimensions: 'librarySearch.dimensions', generator: 'librarySearch.generator', rating: 'librarySearch.rating', prompt: 'librarySearch.prompt' };
export const boardMediaLabel = (type: string, t: Translate): string => Object.hasOwn(mediaKeys, type) ? t(mediaKeys[type]) : type;
export const boardMetadataLabel = (field: string, t: Translate): string => Object.hasOwn(metadataKeys, field) ? t(metadataKeys[field]) : field;

const groupingKeys: Partial<Record<BoardGroupingDimension, MessageKey>> = {
  model: 'canvas.checkpoint', sampler: 'librarySearch.sampler', scheduler: 'librarySearch.scheduler', seed: 'libraryGallery.seed', dimensions: 'canvas.resolution', generator: 'librarySearch.generator',
  rating: 'librarySearch.rating', favorite: 'canvas.favorite', tag: 'canvas.tag', autoTag: 'canvas.autoTag', date: 'canvas.date', session: 'canvas.session', folder: 'canvas.folder', collection: 'canvas.collection', cluster: 'canvas.cluster',
};
export const boardGroupingLabel = (dimension: BoardGroupingDimension, t: Translate): string => {
  const key = groupingKeys[dimension];
  return key ? t(key) : groupingLabels[dimension];
};
