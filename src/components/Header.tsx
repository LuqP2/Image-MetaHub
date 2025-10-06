import React from 'react';

interface HeaderProps {
  onAddFolder: () => void;
  onOpenSettings: () => void;
}

const FolderPlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h5l2 3h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </svg>
);

const CogIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.096 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const Header: React.FC<HeaderProps> = ({ onAddFolder, onOpenSettings }) => {
  return (
    <header className="h-12 flex-shrink-0 bg-white border-b border-gray-200 flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onAddFolder}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 bg-white rounded-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <FolderPlusIcon />
          Add Folder
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenSettings}
          className="flex items-center justify-center p-2 text-gray-600 bg-white rounded-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <CogIcon />
        </button>
      </div>
    </header>
  );
};

export default Header;