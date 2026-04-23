import React, { useRef, useEffect } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { ZoomIn, ZoomOut } from 'lucide-react';
import Tooltip from './Tooltip';

const ImageSizeSlider: React.FC = () => {
  const { imageSize, setImageSize } = useSettingsStore();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setImageSize(Number(event.target.value));
  };

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -10 : 10; // Scroll down = zoom out, scroll up = zoom in
    const newSize = Math.max(80, Math.min(320, imageSize + delta));
    setImageSize(newSize);
  };

  useEffect(() => {
    const inputElement = inputRef.current;
    if (inputElement) {
      inputElement.addEventListener('wheel', handleWheel, { passive: false });
      return () => {
        inputElement.removeEventListener('wheel', handleWheel);
      };
    }
  }, [imageSize]);

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
      <Tooltip label="Zoom Out">
        <button 
          onClick={handleZoomOut}
          className="p-1 hover:bg-gray-700 rounded transition-colors"
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <ZoomOut className="h-5 w-5 text-gray-400" />
        </button>
      </Tooltip>
      <Tooltip label="Scroll to adjust zoom">
        <input
          ref={inputRef}
          type="range"
          min="80"
          max="320"
          step="10"
          value={imageSize}
          onChange={handleSizeChange}
          className="w-32 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          title="Scroll to adjust zoom"
          aria-label="Thumbnail size"
        />
      </Tooltip>
      <Tooltip label="Zoom In">
        <button 
          onClick={handleZoomIn}
          className="p-1 hover:bg-gray-700 rounded transition-colors"
          title="Zoom In"
          aria-label="Zoom In"
        >
          <ZoomIn className="h-5 w-5 text-gray-400" />
        </button>
      </Tooltip>
    </div>
  );
};

export default ImageSizeSlider;
