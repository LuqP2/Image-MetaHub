import { useBoardPrompts } from './BoardPromptContext';
import BoardRichText from './BoardRichText';
import { boardValueLabel } from '../../services/boards/presentation';
import { getBoardDisplayName } from './boardPresentation';
import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import BoardNodeControls from './BoardNodeControls';
import { useBoardEditor } from './BoardEditorContext';
import { useThumbnail } from '../../hooks/useThumbnail';
import { useResolvedThumbnail } from '../../hooks/useResolvedThumbnail';
import { useSettingsStore } from '../../store/useSettingsStore';
import { getImageGenerator } from '../../utils/analyticsUtils';
import Model3DThumbnail from '../Model3DThumbnail';
import BoardVideoPreview from './BoardVideoPreview';
import { useImageStore } from '../../store/useImageStore';

export default memo(function BoardAssetNode({ data, selected }: NodeProps<BoardFlowNode>) {
  const editor = useBoardEditor();
  const prompts = useBoardPrompts();
  const object = data.object;
  const resolution = object.type === 'asset' ? editor.resolveAsset?.(object) : null;
  const image = resolution?.image ?? null;
  const isModel = object.type === 'asset' && object.mediaType === 'model3d';
  useThumbnail(isModel ? null : image);
  const directoryPath = useImageStore(state => state.directories.find(directory => directory.id === image?.directoryId)?.path);
  const thumbnail = useResolvedThumbnail(image);
  const enableSafeMode = useSettingsStore(state => state.enableSafeMode);
  const sensitiveTags = useSettingsStore(state => state.sensitiveTags);
  const blurSensitive = useSettingsStore(state => state.blurSensitiveImages);
  const disableThumbnails = useSettingsStore(state => state.disableThumbnails);
  if (object.type !== 'asset') return null;
  const blurred = enableSafeMode && blurSensitive && image?.tags?.some(tag => sensitiveTags.some(sensitive => sensitive.toLowerCase() === tag.toLowerCase()));
  const source = thumbnail?.thumbnailUrl;
  const fields = image ? { model: image.models?.join(', '), loras: image.loras?.map(lora => typeof lora === 'string' ? lora : lora.name).join(', '), seed: image.seed, dimensions: image.dimensions, generator: getImageGenerator(image), rating: image.rating, prompt: image.prompt } : null;
  return <div className="board-asset" data-prompt-match={!editor.exporting && !!image && prompts.matchedIds.has(image.id) || undefined} data-export-pending={!!image && !isModel && !source && !disableThumbnails && thumbnail?.thumbnailStatus !== 'ready' && thumbnail?.thumbnailStatus !== 'error'} data-export-error={!!image && !isModel && !source && thumbnail?.thumbnailStatus === 'error'} onDoubleClick={() => editor.openAsset?.(object)}>
    <BoardNodeControls selected={!!selected} keepAspectRatio />
    <div className="board-asset-picture" style={{ filter: blurred ? 'blur(20px)' : undefined }}>
      {image && isModel && !disableThumbnails ? <Model3DThumbnail key={image.id} image={image} directoryPath={directoryPath} eager={editor.exporting} />
        : image && object.mediaType === 'video' && !editor.exporting && !disableThumbnails ? <BoardVideoPreview key={image.id} image={image} directoryPath={directoryPath} poster={source ?? undefined} />
        : source ? <img src={source} alt={object.name} draggable={false} />
        : <span>{resolution?.status === 'loading' ? 'Loading…' : resolution?.status === 'ambiguous' ? 'Choose a reference' : `${object.mediaType} · Unavailable`}</span>}
    </div>
    <div className="board-asset-caption" title={object.name}>{getBoardDisplayName(object.name)}{object.mediaType !== 'image' && <span>{object.mediaType}</span>}</div>
    {fields && object.visibleFields.length > 0 && <div className="board-asset-fields">{object.visibleFields.map(field => <div key={field} title={String(fields[field] ?? '')}><strong>{field}</strong> {field === 'model' ? image?.models?.map(boardValueLabel).join(', ') || '—' : <BoardRichText text={String(fields[field] ?? '—')} />}</div>)}</div>}
  </div>;
});
