import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, RefreshCw } from 'lucide-react';

const UpdateNotification = () => {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloaded, setIsDownloaded] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo(info);
    });

    window.electronAPI.onUpdateProgress((progress) => {
      setDownloadProgress(progress.percent);
    });

    window.electronAPI.onUpdateDownloaded(() => {
      setIsDownloaded(true);
    });
  }, []);

  const handleDownload = async () => {
    try {
      await window.electronAPI?.startUpdateDownload();
    } catch (error) {
      console.error('Failed to start update download:', error);
    }
  };

  const handleInstall = async () => {
    try {
      await window.electronAPI?.installUpdate();
    } catch (error) {
      console.error('Failed to install update:', error);
    }
  };

  const handleClose = () => {
    setUpdateInfo(null);
  };

  return (
    <AnimatePresence>
      {updateInfo && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-4 right-4 bg-gray-800 text-white p-4 rounded-lg shadow-lg z-50 w-96"
        >
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold">Update Available!</h3>
            <button onClick={handleClose} className="text-gray-400 hover:text-white">
              <X size={20} />
            </button>
          </div>
          <p className="text-sm mt-2">
            Version {updateInfo.version} is now available.
          </p>
          <div className="mt-4">
            {isDownloaded ? (
              <button
                onClick={handleInstall}
                className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded flex items-center justify-center"
              >
                <RefreshCw size={16} className="mr-2" />
                Restart & Install
              </button>
            ) : (
              <>
                <button
                  onClick={handleDownload}
                  disabled={downloadProgress > 0}
                  className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded flex items-center justify-center disabled:bg-gray-500"
                >
                  <Download size={16} className="mr-2" />
                  Download
                </button>
                {downloadProgress > 0 && (
                  <div className="w-full bg-gray-700 rounded-full h-2.5 mt-2">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full"
                      style={{ width: `${downloadProgress}%` }}
                    ></div>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default UpdateNotification;
