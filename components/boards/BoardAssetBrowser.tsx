import { useBoardUIStore } from '../../store/useBoardUIStore';
import { getBoardDisplayName } from './boardPresentation';
import { useMemo } from 'react';
import { create } from 'zustand';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import type { Directory, IndexedImage } from '../../types';
import { useThumbnail } from '../../hooks/useThumbnail';
import { useResolvedThumbnail } from '../../hooks/useResolvedThumbnail';
import { useSettingsStore } from '../../store/useSettingsStore';
import { searchBoardAssets } from '../../services/boards/assetSearch';
import { clearInternalImageDragData, setInternalImageDragData } from '../../utils/internalImageDrag';
import { getHiddenSensitiveTagSet, isVisibleWithSafeMode } from '../../utils/safeModeVisibility';

const useBrowserState = create<{ query: string; directoryId: string; mediaType: string; selectedIds: string[] }>(() => ({ query: '', directoryId: '', mediaType: '', selectedIds: [] }));
function AssetTile({ image, selected, onSelect, editable, draggingIds }: { image: IndexedImage; selected: boolean; onSelect(multiple: boolean): void; editable: boolean; draggingIds: string[] }) {
  useThumbnail(image);
  const thumbnail = useResolvedThumbnail(image);
  const enableSafeMode = useSettingsStore(state => state.enableSafeMode);
  const sensitiveTags = useSettingsStore(state => state.sensitiveTags);
  const blurSensitive = useSettingsStore(state => state.blurSensitiveImages);
  const blurred = enableSafeMode && blurSensitive && image.tags?.some(tag => sensitiveTags.some(sensitive => sensitive.toLowerCase() === tag.toLowerCase()));
  return <button className={`board-browser-tile ${selected ? 'selected' : ''}`} title={image.name} aria-pressed={selected}
    onClick={event => onSelect(event.shiftKey || event.ctrlKey || event.metaKey)} draggable={editable}
    onDragStart={event => { event.dataTransfer.effectAllowed = 'copy'; setInternalImageDragData(event.dataTransfer, image.id, draggingIds.includes(image.id) ? draggingIds : [image.id]); }}
    onDragEnd={clearInternalImageDragData}>
    {thumbnail?.thumbnailUrl ? <img src={thumbnail.thumbnailUrl} alt="" draggable={false} style={{ filter: blurred ? 'blur(16px)' : undefined }} /> : <span>Preview</span>}
    <span>{getBoardDisplayName(image.name)}</span>
  </button>;
}
interface RowData { images: IndexedImage[]; selectedIds: string[]; editable: boolean; onPick?: (image: IndexedImage) => void }
function BrowserRow({ index, style, data }: ListChildComponentProps<RowData>) {
  return <div style={{ ...style, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '4px 8px' }}>
    {data.images.slice(index * 2, index * 2 + 2).map(image => <AssetTile key={image.id} image={image} selected={data.selectedIds.includes(image.id)} editable={data.editable} draggingIds={data.selectedIds}
      onSelect={multiple => {
        if (data.onPick) { data.onPick(image); return; }
        const selected = new Set(multiple ? useBrowserState.getState().selectedIds : []);
        if (multiple && selected.has(image.id)) selected.delete(image.id); else selected.add(image.id);
        useBrowserState.setState({ selectedIds: [...selected] });
      }} />)}
  </div>;
}

export default function BoardAssetBrowser({ images, directories, editable, onAdd, onPick, onCancelPick, open = true, onOpenChange }: {
  images: IndexedImage[]; directories: Directory[]; editable: boolean; onAdd(images: IndexedImage[]): void;
  open?: boolean; onOpenChange?: (open: boolean) => void;
  onPick?: (image: IndexedImage) => void; onCancelPick?: () => void;
}) {
  const state = useBrowserState();
  const enableSafeMode = useSettingsStore(settings => settings.enableSafeMode);
  const blurSensitiveImages = useSettingsStore(settings => settings.blurSensitiveImages);
  const sensitiveTags = useSettingsStore(settings => settings.sensitiveTags);
  const visibleImages = useMemo(() => {
    const hiddenTags = getHiddenSensitiveTagSet({ enableSafeMode, blurSensitiveImages, sensitiveTags });
    return hiddenTags ? images.filter(image => isVisibleWithSafeMode(image, hiddenTags)) : images;
  }, [images, enableSafeMode, blurSensitiveImages, sensitiveTags]);
  const selectedIds = useMemo(() => {
    const visibleIds = new Set(visibleImages.map(image => image.id));
    return state.selectedIds.filter(id => visibleIds.has(id));
  }, [visibleImages, state.selectedIds]);
  const results = useMemo(() => searchBoardAssets(visibleImages, state.query, state.directoryId, state.mediaType), [visibleImages, state.query, state.directoryId, state.mediaType]);
  const data = useMemo(() => ({ images: results, selectedIds, editable, onPick }), [results, selectedIds, editable, onPick]);
  if (!open && !onPick) return null;
  return <aside className="board-browser" aria-label="Canvas library">
    <div className="board-browser-heading"><strong>{onPick ? 'Choose a replacement' : 'Library'}</strong><button className="board-button" onClick={() => onPick ? onCancelPick?.() : (onOpenChange ?? useBoardUIStore.getState().setLibraryOpen)(false)}>{onPick ? 'Cancel' : 'Hide'}</button></div>
    <input className="board-input" aria-label="Search canvas library" placeholder="Search library…" value={state.query} onChange={event => useBrowserState.setState({ query: event.target.value })} />
    <select className="board-select" aria-label="Canvas library folder" value={state.directoryId} onChange={event => useBrowserState.setState({ directoryId: event.target.value })}><option value="">All folders</option>{directories.map(directory => <option key={directory.id} value={directory.id}>{directory.name}</option>)}</select>
    <select className="board-select" aria-label="Canvas library media type" value={state.mediaType} onChange={event => useBrowserState.setState({ mediaType: event.target.value })}><option value="">All media</option>{['image', 'video', 'audio', 'model3d'].map(type => <option value={type} key={type}>{type}</option>)}</select>
    <p>{results.length} {results.length === 1 ? 'asset' : 'assets'}</p>
    <div className="board-browser-results"><AutoSizer>{({ width, height }) => <FixedSizeList<RowData> className="scrollbar-thin" width={width} height={height} itemCount={Math.ceil(results.length / 2)} itemSize={140} itemData={data}>{BrowserRow}</FixedSizeList>}</AutoSizer></div>
    {!onPick && <button className="board-button board-button--primary" disabled={!editable || !selectedIds.length} onClick={() => onAdd(visibleImages.filter(image => selectedIds.includes(image.id)))}>{selectedIds.length ? `Add to canvas (${selectedIds.length})` : 'Add to canvas'}</button>}
  </aside>;
}
