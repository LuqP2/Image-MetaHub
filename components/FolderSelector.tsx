import React from 'react';

interface FolderSelectorProps {
  onSelectFolder: () => void;
}

const FolderSelector: React.FC<FolderSelectorProps> = ({ onSelectFolder }) => {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="w-full max-w-lg p-8 border-2 border-dashed border-gray-300 rounded-lg bg-white">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <h2 className="text-xl font-semibold mb-2 text-gray-800">Welcome to Image MetaHub</h2>
        <p className="text-gray-600 max-w-md mx-auto mb-6 text-sm">
          To get started, please select the folder where your AI-generated images are stored.
        </p>
        <button
          onClick={onSelectFolder}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Select Image Folder
        </button>
        <p className="text-xs text-gray-500 mt-6 max-w-md mx-auto">
          Note: All processing happens locally in your browser. Your images never leave your computer.
        </p>
      </div>
    </div>
  );
};

export default FolderSelector;