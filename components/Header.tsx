import React from 'react';
import { useImageStore } from '../store/useImageStore';

interface HeaderProps {
  onAddFolder: () => void;
  onOpenSettings: () => void;
}

const Header: React.FC<HeaderProps> = ({ onAddFolder, onOpenSettings }) => {
  const { scanSubfolders, setScanSubfolders } = useImageStore();
  const directories = useImageStore((state) => state.directories);
  const hasDirectories = directories.length > 0;

  // Native-style button classes
  const buttonStyle = `
    px-4 py-2 rounded-sm
    bg-gray-200 text-black
    dark:bg-gray-700 dark:text-gray-100
    hover:bg-gray-300 dark:hover:bg-gray-600
    focus:outline-none focus:ring-2 focus:ring-blue-500
  `;

  // Simplified checkbox style
  const checkboxLabelStyle = "flex items-center text-sm text-gray-700 dark:text-gray-300";
  const checkboxInputStyle = "h-4 w-4 rounded-sm border-gray-400 dark:border-gray-500 focus:ring-blue-500 mr-2";

  return (
    <header className="flex items-center justify-end p-2 border-b border-gray-300 dark:border-gray-700">
      <div className="flex items-center gap-4">
        {hasDirectories && (
          <div className={checkboxLabelStyle} title="Toggles whether sub-folders are scanned for images.">
            <input
              type="checkbox"
              id="scanSubfolders"
              checked={scanSubfolders}
              onChange={(e) => setScanSubfolders(e.target.checked)}
              className={checkboxInputStyle}
            />
            <label htmlFor="scanSubfolders">
              Scan Subfolders
            </label>
          </div>
        )}
        <button
          onClick={onAddFolder}
          className={buttonStyle}
          title="Add a folder to scan"
        >
          Change Folder
        </button>
        <button
          onClick={onOpenSettings}
          className={buttonStyle}
          title="Open Settings"
        >
          Settings
        </button>
      </div>
    </header>
  );
};

export default Header;