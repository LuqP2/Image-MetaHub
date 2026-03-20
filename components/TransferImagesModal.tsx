import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Copy, Folder, MoveRight, X } from 'lucide-react';
import type { Directory, IndexedImage, IndexedImageTransferMode } from '../types';

interface TransferImagesModalProps {
  isOpen: boolean;
  images: IndexedImage[];
  directories: Directory[];
  mode: IndexedImageTransferMode;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (directory: Directory) => Promise<void> | void;
}

const TransferImagesModal: React.FC<TransferImagesModalProps> = ({
  isOpen,
  images,
  directories,
  mode,
  isSubmitting,
  onClose,
  onConfirm,
}) => {
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string>('');

  const imageCount = images.length;
  const firstImage = images[0];
  const title = mode === 'move' ? 'Move To' : 'Copy To';

  const sortedDirectories = useMemo(
    () => [...directories].sort((a, b) => a.name.localeCompare(b.name)),
    [directories],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedDirectoryId(sortedDirectories[0]?.id ?? '');
  }, [isOpen, sortedDirectories]);

  if (!isOpen) return null;

  const selectedDirectory = sortedDirectories.find((directory) => directory.id === selectedDirectoryId);
  const actionIcon = mode === 'move' ? <MoveRight className="w-5 h-5 text-amber-300" /> : <Copy className="w-5 h-5 text-blue-300" />;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-gray-700">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-800 rounded-lg">
              {actionIcon}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{title}</h2>
              <p className="text-sm text-gray-400">
                {imageCount} image{imageCount === 1 ? '' : 's'} selected
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title="Close"
            disabled={isSubmitting}
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <ArrowRightLeft className="w-4 h-4 text-gray-400" />
              <span>
                {mode === 'move' ? 'Move' : 'Copy'} will preserve tags, favorites, and shadow metadata.
              </span>
            </div>
            {firstImage && (
              <p className="mt-2 text-xs text-gray-400 truncate">
                Example: {firstImage.name}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-300">Destination folder</label>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {sortedDirectories.map((directory) => (
                <button
                  key={directory.id}
                  type="button"
                  onClick={() => setSelectedDirectoryId(directory.id)}
                  className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                    selectedDirectoryId === directory.id
                      ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                      : 'border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Folder className="w-4 h-4 flex-shrink-0" />
                    <span className="font-medium truncate">{directory.name}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400 truncate">{directory.path}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              onClick={() => selectedDirectory && onConfirm(selectedDirectory)}
              className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={!selectedDirectory || isSubmitting}
            >
              {isSubmitting
                ? (mode === 'move' ? 'Moving...' : 'Copying...')
                : `${mode === 'move' ? 'Move' : 'Copy'} ${imageCount} image${imageCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransferImagesModal;
