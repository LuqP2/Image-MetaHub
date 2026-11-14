import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import { mediaSourceCache } from '../services/mediaSourceCache';
import { useImageStore } from '../store/useImageStore';
import type { IndexedImage } from '../types';
import { getModelTextureMapIndex, textureMapLabels, type IndexedTextureMap } from '../utils/modelTextureMaps';

function TextureMapCard({ map, onOpen }: { map: IndexedTextureMap; onOpen: (image: IndexedImage) => void }) {
  const { image, role } = map;
  const thumbnail = useResolvedThumbnail(image)?.thumbnailUrl;
  const directoryPath = useImageStore((state) => state.directories.find((dir) => dir.id === image.directoryId)?.path);
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    if (thumbnail) return;
    let active = true;
    void mediaSourceCache.getOrLoad(image, directoryPath).then((url) => {
      if (active) setSource(url);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [directoryPath, image, thumbnail]);
  const url = thumbnail ?? source;
  return (
    <button type="button" onClick={() => onOpen(image)} title={image.name}
      className="flex min-w-0 items-center gap-2 rounded border border-gray-700 p-1.5 text-left hover:bg-gray-800">
      {url ? <img src={url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : <ImageIcon size={18} className="mx-2 shrink-0" />}
      <span className="min-w-0">
        <span className="block text-xs font-medium">{textureMapLabels[role]}</span>
        <span className="block truncate text-xs text-gray-400">{image.name}</span>
      </span>
    </button>
  );
}

export function TextureMapsSection({ image, maps, onOpen }: {
  image: IndexedImage;
  maps?: IndexedTextureMap[];
  onOpen: (image: IndexedImage) => void;
}) {
  const indexedMaps = useImageStore((state) => maps ? undefined : getModelTextureMapIndex(state.images).byModelId.get(image.id));
  const rows = maps ?? indexedMaps;
  const [expanded, setExpanded] = useState(false);
  if (!rows?.length) return null;
  return (
    <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="shrink-0 border-t border-gray-700 bg-gray-900 px-3 py-2 text-gray-100">
      <summary className="cursor-pointer text-xs font-semibold">Texture Maps ({rows.length})</summary>
      {expanded && <div className="mt-2 grid max-h-40 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2 overflow-y-auto">
        {rows.map((map) => <TextureMapCard key={map.image.id} map={map} onOpen={onOpen} />)}
      </div>}
    </details>
  );
}
