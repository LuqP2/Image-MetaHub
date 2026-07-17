import React from 'react';
import { Box, Search } from 'lucide-react';
import { IndexedImage } from '../types';
import ScopeCard from './ScopeCard';

interface ModelCardProps {
  modelName: string;
  images: IndexedImage[];
  imageCount: number;
  onClick: () => void;
  onFindMatchingPrompts?: () => void;
  isActive?: boolean;
}

const ModelCard: React.FC<ModelCardProps> = ({
  modelName,
  images,
  imageCount,
  onClick,
  onFindMatchingPrompts,
  isActive = false,
}) => (
  <ScopeCard
    images={images}
    icon={Box}
    coverAlt={modelName}
    countLabel={imageCount}
    title={modelName}
    isActive={isActive}
    onClick={onClick}
    secondaryAction={
      onFindMatchingPrompts ? (
        <div
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onFindMatchingPrompts();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onFindMatchingPrompts();
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 transition-colors hover:border-cyan-300 hover:bg-cyan-500/20"
          title={`Find matching prompts for ${modelName}`}
          aria-label={`Find matching prompts for ${modelName}`}
        >
          <Search className="h-3.5 w-3.5" />
          Match prompts
        </div>
      ) : undefined
    }
    subtitle={
      <p className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-400">
        <span>
          {imageCount} image{imageCount !== 1 ? 's' : ''}
        </span>
        {isActive && <span className="shrink-0 text-blue-300">Selected</span>}
      </p>
    }
  />
);

export default ModelCard;
