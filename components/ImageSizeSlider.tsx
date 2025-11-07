import React from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { ZoomIn, ZoomOut } from 'lucide-react';

const ImageSizeSlider: React.FC = () => {
  const { imageSize, setImageSize } = useSettingsStore();

  const handleSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setImageSize(Number(event.target.value));
  };

  const handleZoomOut = () => {
    const newSize = Math.max(80, imageSize - 10);
    setImageSize(newSize);
  };

  const handleZoomIn = () => {
    const newSize = Math.min(320, imageSize + 10);
    setImageSize(newSize);
  };

  return (
    <div className="flex items-center gap-2">
      <button 
        onClick={handleZoomOut}
        className="p-1 hover:bg-gray-700 rounded transition-colors"
        title="Zoom Out"
      >
        <ZoomOut className="h-5 w-5 text-gray-400" />
      </button>
      <input
        type="range"
        min="80"
        max="320"
        step="10"
        value={imageSize}
        onChange={handleSizeChange}
        className="w-32 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
      />
      <button 
        onClick={handleZoomIn}
        className="p-1 hover:bg-gray-700 rounded transition-colors"
        title="Zoom In"
      >
        <ZoomIn className="h-5 w-5 text-gray-400" />
      </button>
    </div>
  );
};

export default ImageSizeSlider;