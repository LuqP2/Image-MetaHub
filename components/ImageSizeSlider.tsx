import React from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { ZoomIn, ZoomOut } from 'lucide-react';

/**
 * @function ImageSizeSlider
 * @description A slider component for adjusting the size of the images in the grid.
 * @returns {React.FC} - The rendered component.
 */
const ImageSizeSlider: React.FC = () => {
  const { imageSize, setImageSize } = useSettingsStore();

  /**
   * @function handleSizeChange
   * @description Handles the change event of the slider and updates the image size.
   * @param {React.ChangeEvent<HTMLInputElement>} event - The change event.
   */
  const handleSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setImageSize(Number(event.target.value));
  };

  return (
    <div className="flex items-center gap-2">
      <ZoomOut className="h-5 w-5 text-gray-400" />
      <input
        type="range"
        min="80"
        max="320"
        step="10"
        value={imageSize}
        onChange={handleSizeChange}
        className="w-32 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
      />
      <ZoomIn className="h-5 w-5 text-gray-400" />
    </div>
  );
};

export default ImageSizeSlider;