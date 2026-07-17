import React from 'react';
import { Layers, Lock } from 'lucide-react';
import { ImageCluster, IndexedImage } from '../types';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import ScopeCard from './ScopeCard';

interface StackCardProps {
  cluster: ImageCluster;
  images: IndexedImage[];
  onOpen: () => void;
  isLocked?: boolean;
}

const StackCard: React.FC<StackCardProps> = ({ cluster, images, onOpen, isLocked = false }) => {
  const { showProModal } = useFeatureAccess();

  const promptLabel = cluster.basePrompt || images[0]?.prompt || 'Untitled stack';
  const displayCount = images.length;
  const totalCount = cluster.size;
  const countLabel = displayCount === totalCount ? `${displayCount}` : `${displayCount}/${totalCount}`;
  const detailCountLabel =
    displayCount === totalCount ? `${displayCount} images` : `${displayCount}/${totalCount} images`;

  const handleClick = () => {
    if (isLocked) {
      showProModal('clustering');
    } else {
      onOpen();
    }
  };

  return (
    <ScopeCard
      images={images}
      icon={Layers}
      coverAlt={promptLabel}
      countLabel={countLabel}
      title={promptLabel}
      onClick={handleClick}
      coverBlur={isLocked}
      disableScrub={isLocked}
      variantClassName={
        isLocked
          ? 'border-purple-500/40 hover:shadow-xl hover:shadow-purple-500/30'
          : 'border-gray-800 hover:shadow-xl hover:shadow-blue-500/20'
      }
      overlay={
        isLocked ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="flex flex-col items-center gap-2 text-purple-300">
              <Lock className="h-12 w-12" />
              <span className="text-sm font-semibold">Pro Only</span>
            </div>
          </div>
        ) : undefined
      }
      subtitle={
        <p className="mt-1 text-xs text-gray-400">
          {detailCountLabel} | similarity {Math.round(cluster.similarityThreshold * 100)}%
        </p>
      }
    />
  );
};

export default StackCard;
