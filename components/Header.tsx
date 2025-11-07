import React from 'react';
import { Settings, Plus, Bug, HelpCircle } from 'lucide-react';

interface HeaderProps {
  onAddFolder: () => void;
  onOpenSettings: () => void;
  onShowChangelog?: () => void;
  isIndexing?: boolean;
  isIndexingPaused?: boolean;
}

const Header: React.FC<HeaderProps> = ({ onAddFolder, onOpenSettings, onShowChangelog, isIndexing = false, isIndexingPaused = false }) => {
  return (
    <header className="bg-gray-800/80 backdrop-blur-sm sticky top-0 z-10 p-4 shadow-md">
      <div className="container mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="/logo1.svg" alt="Image MetaHub" className="h-8 w-8" />
          <h1 className="text-2xl font-bold tracking-wider">Image MetaHub v0.9.5</h1>
        </div>
        <div className="flex items-center gap-4">
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