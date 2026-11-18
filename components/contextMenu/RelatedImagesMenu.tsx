import { useTranslation } from '../../i18n/useTranslation';
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
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const selectMode = (mode: RelatedImagesMode) => {
    onClose();
    onFindRelated(image, mode);
  };

  return (
    <ContextMenuSubmenu
      label={t('libraryGallery.findRelatedImages')}
      icon={<Images size={16} />}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      horizontalClass={horizontalClass}
    >
      <ContextMenuButton label={t('libraryGallery.sameSession')} icon={<Clock size={16} />} onClick={() => selectMode('session')} />
      <ContextMenuButton label={t('libraryGallery.sameDate')} icon={<CalendarDays size={16} />} onClick={() => selectMode('date')} />
    </ContextMenuSubmenu>
  );
}
