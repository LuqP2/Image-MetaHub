import React, { useRef } from 'react';
import { Box } from 'lucide-react';
import { IndexedImage } from '../types';
import { useThumbnail } from '../hooks/useThumbnail';

interface ModelCardProps {
  modelName: string;
  coverImage: IndexedImage | null;
  imageCount: number;
  onClick: () => void;
}

const ModelCard: React.FC<ModelCardProps> = ({ modelName, coverImage, imageCount, onClick }) => {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  
  // Use the hook to load the thumbnail if we have a cover image
  useThumbnail(coverImage);

  const coverUrl = coverImage?.thumbnailUrl || '';

  return (
    <button
      ref={cardRef}
      onClick={onClick}
      className="group text-left bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden shadow-lg transition-all hover:shadow-xl hover:shadow-blue-500/20 hover:border-blue-500/30 cursor-pointer"
      type="button"
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={modelName}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 flex items-center justify-center text-gray-400">
            <Box className="w-8 h-8 opacity-70" />
          </div>
        )}

        <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-gray-100">
          <Box className="w-3.5 h-3.5" />
          {imageCount}
        </div>
        
        {/* Overlay gradient for text readability */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
      </div>
      
      <div className="p-3">
        <p className="text-sm font-semibold text-gray-100 truncate" title={modelName}>
          {modelName}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          {imageCount} image{imageCount !== 1 ? 's' : ''}
        </p>
      </div>
    </button>
  );
};

export default ModelCard;
