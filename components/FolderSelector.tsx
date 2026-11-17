import { useTranslation } from '../i18n/useTranslation';

import React, { useEffect } from 'react';
import { useImageStore } from '../store/useImageStore';
import BrandLogo from './BrandLogo';
import { version } from '../package.json';

interface FolderSelectorProps {
  onSelectFolder: () => void;
}

const welcomeVersion = version.split('.').slice(0, 2).join('.');

const FolderSelector: React.FC<FolderSelectorProps> = ({ onSelectFolder }) => {
  const { t } = useTranslation();
  const { setScanSubfolders } = useImageStore();

  // Always ensure scanning subfolders is enabled
  useEffect(() => {
    setScanSubfolders(true);
  }, [setScanSubfolders]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8 border-2 border-dashed border-gray-700 rounded-xl bg-gray-800/50">
      <BrandLogo variant="welcome" />
      <h2 className="text-2xl font-semibold mb-2 text-gray-100">{t('libraryFolders.welcome', { version: welcomeVersion })}</h2>
      <p className="text-gray-400 max-w-md mb-6">
        {t('libraryFolders.welcomeDescription')}
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
        className="folder-selector-button bg-blue-500 hover:bg-blue-600 text-gray-950 hover:text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg"
      >
        {t('libraryFolders.selectImageFolder')}
      </button>
       <p className="text-xs text-gray-500 mt-6 whitespace-nowrap">
        {t('libraryFolders.localProcessing')}
      </p>
    </div>
  );
};

export default FolderSelector;
