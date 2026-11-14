import React, { useState } from 'react';
import { CalendarDays, Clock, Images } from 'lucide-react';
import type { IndexedImage } from '../../types';
import type { RelatedImagesMode } from '../../utils/relatedImages';
import { ContextMenuButton, ContextMenuSubmenu } from './ContextMenuPrimitives';

interface RelatedImagesMenuProps {
  image: IndexedImage;
  horizontalClass: string;
  onFindRelated: (image: IndexedImage, mode: RelatedImagesMode) => void;
  onClose: () => void;
}

export default function RelatedImagesMenu({ image, horizontalClass, onFindRelated, onClose }: RelatedImagesMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectMode = (mode: RelatedImagesMode) => {
    onClose();
    onFindRelated(image, mode);
  };

  return (
    <ContextMenuSubmenu
      label="Find Related Images"
      icon={<Images size={16} />}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      horizontalClass={horizontalClass}
    >
      <ContextMenuButton label="Same Session" icon={<Clock size={16} />} onClick={() => selectMode('session')} />
      <ContextMenuButton label="Same Date" icon={<CalendarDays size={16} />} onClick={() => selectMode('date')} />
    </ContextMenuSubmenu>
  );
}
