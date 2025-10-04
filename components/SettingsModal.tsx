import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { X } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const cachePath = useSettingsStore((state) => state.cachePath);
  const autoUpdate = useSettingsStore((state) => state.autoUpdate);
  const setCachePath = useSettingsStore((state) => state.setCachePath);
  const toggleAutoUpdate = useSettingsStore((state) => state.toggleAutoUpdate);

  const [currentCachePath, setCurrentCachePath] = useState('');
  const [defaultCachePath, setDefaultCachePath] = useState('');

  useEffect(() => {
    if (isOpen) {
      // Fetch the default path when the modal opens
      window.electronAPI?.getDefaultCachePath().then(result => {
        if (result.success && result.path) {
          setDefaultCachePath(result.path);
          setCurrentCachePath(cachePath || result.path);
        }
      }).catch(error => {
        console.error('Failed to get default cache path:', error);
      });
    }
  }, [isOpen, cachePath]);

  const handleSelectCacheDirectory = async () => {
    const result = await window.electronAPI?.showDirectoryDialog();
    if (result && result.success && result.path) {
      setCachePath(result.path);
      setCurrentCachePath(result.path);
    }
  };

  const handleResetCacheDirectory = () => {
    setCachePath(defaultCachePath);
    setCurrentCachePath(defaultCachePath);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center">
      <div className="bg-gray-800 text-white rounded-lg shadow-xl p-6 w-full max-w-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Settings</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-700">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-6">
          {/* Cache Location Setting */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Cache Location</h3>
            <p className="text-sm text-gray-400 mb-2">
              The directory where the image index cache is stored.
            </p>
            <div className="bg-gray-900 p-2 rounded-md text-sm truncate">
              {currentCachePath || 'Loading...'}
            </div>
            <div className="flex items-center space-x-2 mt-2">
              <button
                onClick={handleSelectCacheDirectory}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md text-sm font-medium"
              >
                Change Location
              </button>
              <button
                onClick={handleResetCacheDirectory}
                disabled={currentCachePath === defaultCachePath}
                className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
              >
                Reset to Default
              </button>
            </div>
             <p className="text-xs text-gray-500 mt-2">
              Default: {defaultCachePath}
            </p>
          </div>

          {/* Auto-update Setting */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Automatic Updates</h3>
            <div className="flex items-center justify-between bg-gray-900 p-3 rounded-md">
              <div>
                <p className="text-sm">Check for updates on startup</p>
                <p className="text-xs text-gray-400">
                  When disabled, the app will not check for new versions online.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoUpdate}
                  onChange={toggleAutoUpdate}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-focus:ring-4 peer-focus:ring-blue-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
            <p className="text-xs text-gray-500">Changes are saved automatically. You may need to restart the application for some changes to take full effect.</p>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;