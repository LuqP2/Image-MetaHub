import React from 'react';
import { useImageStore } from '../store/useImageStore';

interface HeaderProps {
  directoryHandle: FileSystemDirectoryHandle | null;
  onUpdateFolder: () => void;
  onChangeFolder: () => void;
}

const Header: React.FC<HeaderProps> = ({ directoryHandle, onUpdateFolder, onChangeFolder }) => {
  const { scanSubfolders, setScanSubfolders } = useImageStore();

  return (
    <header className="bg-gray-800/80 backdrop-blur-sm sticky top-0 z-10 p-4 shadow-lg">
      <div className="container mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.83 2.17C11.42 1.41 10.58 1.41 10.17 2.17L2.17 16.17C1.76 16.93 2.23 18 3 18H21C21.77 18 22.24 16.93 21.83 16.17L13.83 2.17C13.42 1.41 12.58 1.41 12.17 2.17L11.83 2.17Z" fillOpacity="0.01"/>
            <path d="M12 2L3 18H21L12 2ZM12 5.5L18.6 16H5.4L12 5.5Z"/>
          </svg>
          <h1 className="text-2xl font-bold tracking-wider">Image MetaHub</h1>
        </div>
        {directoryHandle && (
          <div className="flex items-center gap-4">
            <div className="flex items-center" title="Toggles whether sub-folders are scanned for images. The folder will be re-scanned when this is toggled.">
              <input
                type="checkbox"
                id="scanSubfolders"
                checked={scanSubfolders}
                onChange={(e) => {
                  setScanSubfolders(e.target.checked);
                  // Trigger a folder refresh when the checkbox is toggled
                  onUpdateFolder();
                }}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="scanSubfolders" className="ml-2 block text-sm text-gray-300">
                Scan Subfolders
              </label>
            </div>
            <button
              onClick={onUpdateFolder}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
              title="Refresh current folder"
            >
              Refresh Folder
            </button>
            <button
              onClick={onChangeFolder}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
              title="Change folder"
            >
              Change Folder
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;