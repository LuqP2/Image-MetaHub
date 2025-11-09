
import React, { useEffect } from 'react';
import { useImageStore } from '../store/useImageStore';

interface FolderSelectorProps {
  onSelectFolder: () => void;
}

const FolderSelector: React.FC<FolderSelectorProps> = ({ onSelectFolder }) => {
  const { setScanSubfolders } = useImageStore();

  // Always ensure scanning subfolders is enabled
  useEffect(() => {
    setScanSubfolders(true);
  }, [setScanSubfolders]);

  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center p-8 border-2 border-dashed border-gray-700 rounded-xl bg-gray-800/50">
      <img src="logo1.png" alt="Image MetaHub Logo" className="h-64 w-64 mb-4 rounded-lg shadow-lg" />
  <h2 className="text-2xl font-semibold mb-2 text-gray-100">Welcome to Image MetaHub v0.9.5</h2>
  <p className="text-xs text-gray-500 mb-4">v0.9.5</p>
      <p className="text-gray-400 max-w-md mb-6">
        To get started, please select the root folder where your AI generated images are stored. The application will scan for images and their metadata locally.
      </p>
      {/* Hidden checkbox - always enabled for scanning subfolders by default */}
      <div className="hidden">
          <input
            type="checkbox"
            id="scanSubfoldersWelcome"
            checked={true}
            onChange={() => setScanSubfolders(true)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
      </div>
      <button
        onClick={onSelectFolder}
        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg"
      >
        Select Image Folder
      </button>
       <p className="text-xs text-gray-500 mt-6 max-w-md">
        Note: All processing happens entirely within your browser. Your images and data never leave your computer. This requires a modern browser (like Chrome or Edge) that supports the File System Access API.
      </p>
    </div>
  );
};

export default FolderSelector;
