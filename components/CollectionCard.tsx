import React from 'react';
import { FolderOpen, Sparkles } from 'lucide-react';
import { IndexedImage, SmartCollection } from '../types';
import ScopeCard from './ScopeCard';

interface CollectionCardProps {
  collection: SmartCollection;
  images: IndexedImage[];
  imageCount: number;
  onClick: () => void;
}

const CollectionCard: React.FC<CollectionCardProps> = ({ collection, images, imageCount, onClick }) => {
  const description = collection.description?.trim() || null;
  const autoAddLabel = collection.sourceTag
    ? collection.autoUpdate !== false
      ? `Auto-add: ${collection.sourceTag}`
      : `Linked tag: ${collection.sourceTag}`
    : null;

  return (
    <ScopeCard
      images={images}
      icon={FolderOpen}
      coverAlt={collection.name}
      countLabel={imageCount}
      title={collection.name}
      ariaLabel={`Open collection ${collection.name}`}
      onClick={onClick}
      contentClassName="p-4"
      badge={
        collection.sourceTag ? (
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
            <Sparkles className="h-3.5 w-3.5" />
            {collection.autoUpdate !== false ? 'Auto' : 'Linked'}
          </div>
        ) : undefined
      }
      subtitle={
        <>
          {description ? (
            <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs text-gray-400">{description}</p>
          ) : (
            <p className="mt-1 min-h-[2.5rem] text-xs text-gray-500">
              {imageCount} image{imageCount !== 1 ? 's' : ''}
            </p>
          )}
          {autoAddLabel && (
            <p className="mt-2 truncate text-[11px] uppercase tracking-wide text-gray-500">{autoAddLabel}</p>
          )}
        </>
      }
    />
  );
};

export default CollectionCard;
