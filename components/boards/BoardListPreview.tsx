import { useBoardReferenceSync } from '../../services/boards/referenceSync';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { IndexedImage } from '../../types';
import type { BoardDocument, BoardSummary } from '../../services/boards/types';
import { loadBoardPreview } from '../../services/boards/preview';
import { useBoardStore } from '../../store/useBoardStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { getHiddenSensitiveTagSet, isVisibleWithSafeMode } from '../../utils/safeModeVisibility';
import { useResolvedThumbnail } from '../../hooks/useResolvedThumbnail';
import type { BoardEditorActions } from './BoardEditorContext';

function PreviewImage({ image, blurred }: { image: IndexedImage; blurred: boolean }) {
  // Subscribe only to thumbnails already resolved by the library; no generation or disk writes.
  const thumbnail = useResolvedThumbnail(image);
  return thumbnail?.thumbnailUrl ? <img src={thumbnail.thumbnailUrl} alt="" draggable={false} style={{ filter: blurred ? 'blur(20px)' : undefined }} /> : <span className="board-preview-file">Reference</span>;
}
export default function BoardListPreview({ summary, resolveAsset }: { summary: BoardSummary; resolveAsset?: BoardEditorActions['resolveAsset'] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState<{ document: BoardDocument; revision: number } | null>(null);
  const previewRevision = useBoardReferenceSync(state => state.previewRevision);
  const sessionDocument = useBoardStore(state => state.sessions[summary.id]?.document);
  const enabled = useSettingsStore(state => state.enableSafeMode);
  const blur = useSettingsStore(state => state.blurSensitiveImages);
  const tags = useSettingsStore(state => state.sensitiveTags);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    observer.observe(ref.current!); return () => observer.disconnect();
  }, []);
  const canResolve = Boolean(resolveAsset);
  useEffect(() => {
    setSaved(null);
    if (!visible || !canResolve || summary.error || sessionDocument) return;
    let current = true;
    void loadBoardPreview(summary, () => current).then(document => { if (current && document) setSaved({ document, revision: previewRevision }); }).catch(() => {});
    return () => { current = false; };
  }, [visible, summary.id, summary.revision, summary.updatedAt, summary.error, sessionDocument, canResolve, previewRevision]);
  const document = sessionDocument ?? (saved?.revision === previewRevision ? saved.document : null);
  const preview = useMemo(() => {
    const images: IndexedImage[] = [], types = new Map<string, number>(), ids = new Set<string>();
    if (!visible || !document) return { images, types };
    const hidden = getHiddenSensitiveTagSet({ enableSafeMode: enabled, blurSensitiveImages: blur, sensitiveTags: tags });
    for (const object of document.objects) {
      const type = object.type === 'smart-frame' ? 'Smart Frame' : object.type === 'asset' ? 'Reference' : object.type === 'text' ? 'Text' : 'Frame';
      types.set(type, (types.get(type) ?? 0) + 1);
      if (object.type !== 'asset' || images.length >= 4) continue;
      const result = resolveAsset?.(object), image = result?.status === 'resolved' ? result.image : undefined;
      if (image && !ids.has(image.id) && isVisibleWithSafeMode(image, hidden)) { images.push(image); ids.add(image.id); }
    }
    return { images, types };
  }, [document, resolveAsset, enabled, blur, tags, visible]);
  return <div ref={ref} className="board-list-preview" style={{ gridTemplateColumns: `repeat(${Math.max(1, preview.images.length)}, minmax(0, 1fr))` }} aria-hidden="true">
    {preview.images.length ? preview.images.map(image => <PreviewImage key={image.id} image={image} blurred={Boolean(enabled && blur && image.tags?.some(tag => tags?.some(sensitive => sensitive.trim().toLowerCase() === tag.toLowerCase())))} />)
      : <div className="board-preview-types">{preview.types.size ? [...preview.types].map(([type, count]) => <span key={type}>{count} {type}{count === 1 ? '' : 's'}</span>) : <span>{summary.objectCount ? 'Visual board' : 'Empty board'}</span>}</div>}
  </div>;
}
