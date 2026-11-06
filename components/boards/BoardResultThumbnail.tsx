import type { IndexedImage } from '../../types';
import { useThumbnail } from '../../hooks/useThumbnail';
import { useResolvedThumbnail } from '../../hooks/useResolvedThumbnail';
import { useSettingsStore } from '../../store/useSettingsStore';
import { getHiddenSensitiveTagSet, isVisibleWithSafeMode } from '../../utils/safeModeVisibility';
import { setInternalImageDragData } from '../../utils/internalImageDrag';
import { setStackCardDrag, setStackCardDragPreview, clearStackCardDrag, type StackCardDrag } from '../../services/boards/stackDrag';

export default function BoardResultThumbnail({ image, open, stackDrag, draggable = true }: { image: IndexedImage; open(): void; stackDrag?: StackCardDrag; draggable?: boolean }) {
  useThumbnail(image);
  const thumbnail = useResolvedThumbnail(image);
  const enabled = useSettingsStore(state => state.enableSafeMode);
  const blur = useSettingsStore(state => state.blurSensitiveImages);
  const tags = useSettingsStore(state => state.sensitiveTags);
  const disableThumbnails = useSettingsStore(state => state.disableThumbnails);
  const settings = { enableSafeMode: enabled, blurSensitiveImages: blur, sensitiveTags: tags };
  if (!isVisibleWithSafeMode(image, getHiddenSensitiveTagSet(settings))) return null;
  const blurred = enabled && blur && image.tags?.some(tag => tags?.some(sensitive => sensitive.trim().toLowerCase() === tag.toLowerCase()));
  return <button data-board-results="true" data-export-pending={!thumbnail?.thumbnailUrl && !disableThumbnails && thumbnail?.thumbnailStatus !== 'ready' && thumbnail?.thumbnailStatus !== 'error'} data-export-error={!thumbnail?.thumbnailUrl && thumbnail?.thumbnailStatus === 'error'} className="board-result-thumb nodrag nopan" onDoubleClick={event => { event.stopPropagation(); open(); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') open(); }}
    draggable={draggable} onDragStart={event => {
      event.stopPropagation();
      if (stackDrag) {
        setStackCardDrag(event.dataTransfer, stackDrag);
        setStackCardDragPreview(event.dataTransfer, event.currentTarget, { x: event.clientX, y: event.clientY });
      } else setInternalImageDragData(event.dataTransfer, image.id);
    }} onDragEnd={() => { if (stackDrag) clearStackCardDrag(); }} aria-label={`Open ${image.name}`}>
    {thumbnail?.thumbnailUrl ? <img src={thumbnail.thumbnailUrl} alt={image.name} draggable={false} style={{ filter: blurred ? 'blur(20px)' : undefined }} /> : <span>{image.name}</span>}
  </button>;
}
