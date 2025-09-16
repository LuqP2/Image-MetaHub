
import React from 'react';

interface FolderSelectorProps {
  onSelectFolder: () => void;
}

const FolderSelector: React.FC<FolderSelectorProps> = ({ onSelectFolder }) => {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center p-8 border-2 border-dashed border-gray-700 rounded-xl bg-gray-800/50">
      <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
      <h2 className="text-2xl font-semibold mb-2 text-gray-100">Welcome to InvokeAI Local Search</h2>
      <p className="text-gray-400 max-w-md mb-6">
        To get started, please select the root folder where your InvokeAI-generated images are stored. The application will scan for images and their metadata locally.
      </p>
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
