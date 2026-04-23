import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { IndexedImage } from '../types';
import { getRenameBasename, renameIndexedImage } from '../services/imageRenameService';

interface RenameImageModalProps {
  image: IndexedImage | null;
  isOpen: boolean;
  onClose: () => void;
  onRenamed?: (result: { oldImageId: string; newImageId: string; newRelativePath: string }) => void;
}

const RenameImageModal: React.FC<RenameImageModalProps> = ({ image, isOpen, onClose, onRenamed }) => {
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen || !image) {
      return;
    }

    setValue(getRenameBasename(image));
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [image, isOpen]);

  if (!isOpen || !image) {
    return null;
  }

  const handleSubmit = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const oldImageId = image.id;
      const result = await renameIndexedImage(image, value);
      if (!result.success || !result.newImageId || !result.newRelativePath) {
        alert(result.error || 'Failed to rename image.');
        return;
      }

      onRenamed?.({
        oldImageId,
        newImageId: result.newImageId,
        newRelativePath: result.newRelativePath,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-4">
          <h2 className="text-sm font-semibold text-white">Rename Image</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <label className="block text-sm text-gray-300">
            Filename
            <input
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleSubmit();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onClose();
                }
              }}
              className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              disabled={isSubmitting}
            />
          </label>
          <p className="text-xs text-gray-500">
            The original extension and subfolder are preserved automatically.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Renaming...' : 'Rename'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RenameImageModal;
