import React from 'react';
import { useImageStore } from '../store/useImageStore';
import { Settings, Plus, GalleryHorizontal, Bug } from 'lucide-react';

interface HeaderProps {
  onAddFolder: () => void;
  onOpenSettings: () => void;
  isIndexing?: boolean;
  isIndexingPaused?: boolean;
}

const Header: React.FC<HeaderProps> = ({ onAddFolder, onOpenSettings, isIndexing = false, isIndexingPaused = false }) => {
  const { scanSubfolders, setScanSubfolders } = useImageStore();
  const directories = useImageStore((state) => state.directories);
  const hasDirectories = directories.length > 0;

  return (
    <header className="bg-gray-800/80 backdrop-blur-sm sticky top-0 z-10 p-4 shadow-md">
      <div className="container mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <GalleryHorizontal className="h-8 w-8 text-accent" />
          <h1 className="text-2xl font-bold tracking-wider">Image MetaHub</h1>
        </div>
        <div className="flex items-center gap-4">
          {hasDirectories && (
            <>
              <div className="flex items-center" title="Toggles whether sub-folders are scanned for images. A manual refresh of a folder is required to apply this setting.">
                <input
                  type="checkbox"
                  id="scanSubfolders"
                  checked={scanSubfolders}
                  onChange={(e) => setScanSubfolders(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent"
                />
                <label htmlFor="scanSubfolders" className="ml-2 block text-sm text-gray-300">
                  Scan Subfolders
                </label>
              </div>
              <div className="border-l border-gray-600 h-8 mx-2"></div>
            </>
          )}
          <button
            onClick={onAddFolder}
            disabled={isIndexing || isIndexingPaused}
            className={`px-4 py-2 rounded-lg transition-all duration-200 flex items-center gap-2 ${
              isIndexing || isIndexingPaused
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                : 'bg-accent hover:bg-blue-700 text-white hover:shadow-lg hover:shadow-accent/30'
            }`}
            title={isIndexing || isIndexingPaused ? "Cannot add folder during indexing" : "Add a folder to scan"}
          >
            <Plus size={18} />
            Add Folder
          </button>
          <a
            href="https://github.com/LuqP2/Image-MetaHub/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="px-2 py-2 rounded-lg transition-colors text-sm text-gray-400 hover:bg-gray-700 hover:text-white flex items-center gap-2"
            title="Report a bug or provide feedback"
          >
            <Bug size={16} />
            Feedback & Bugs
          </a>
          <div className="border-l border-gray-600 h-8 mx-2"></div>
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-full hover:bg-gray-700 transition-colors hover:shadow-lg hover:shadow-accent/30"
            title="Open Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;