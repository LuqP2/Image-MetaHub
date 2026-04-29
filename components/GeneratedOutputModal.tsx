import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, X } from 'lucide-react';
import { GeneratedQueueOutput } from '../store/useGenerationQueueStore';

interface GeneratedOutputModalProps {
  outputs: GeneratedQueueOutput[];
  initialIndex?: number;
  jobName?: string;
  onOpenIndexedImage?: (imageId: string) => void;
  onClose: () => void;
}

const GeneratedOutputModal: React.FC<GeneratedOutputModalProps> = ({
  outputs,
  initialIndex = 0,
  jobName,
  onOpenIndexedImage,
  onClose,
}) => {
  const [index, setIndex] = useState(() => Math.min(initialIndex, Math.max(outputs.length - 1, 0)));
  const current = outputs[index];
  const hasMultiple = outputs.length > 1;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
      if (event.key === 'ArrowLeft') {
        setIndex((currentIndex) => Math.max(0, currentIndex - 1));
      }
      if (event.key === 'ArrowRight') {
        setIndex((currentIndex) => Math.min(outputs.length - 1, currentIndex + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, outputs.length]);

  if (!current) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-700 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-gray-100">
              {current.name || jobName || 'Generated output'}
            </h2>
            {jobName && current.name !== jobName && (
              <p className="truncate text-xs text-gray-500">{jobName}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasMultiple && (
              <span className="text-xs text-gray-400">
                {index + 1}/{outputs.length}
              </span>
            )}
            {current.kind === 'remote-url' && current.url && (
              <a
                href={current.url}
                target="_blank"
                rel="noreferrer"
                className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-100"
                aria-label="Open image in browser"
                title="Open image in browser"
              >
                <ExternalLink size={18} />
              </a>
            )}
            {current.imageId && onOpenIndexedImage && (
              <button
                onClick={() => onOpenIndexedImage(current.imageId!)}
                className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
                aria-label="View full metadata"
                title="View full metadata"
              >
                <FileText size={16} />
                <span>View full metadata</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-100"
              aria-label="Close generated output preview"
              title="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
          {hasMultiple && (
            <button
              onClick={() => setIndex((currentIndex) => Math.max(0, currentIndex - 1))}
              disabled={index === 0}
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-gray-900/80 p-2 text-gray-100 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous generated image"
              title="Previous"
            >
              <ChevronLeft size={24} />
            </button>
          )}
          {current.url ? (
            <img
              src={current.url}
              alt={current.name || 'Generated output'}
              className="max-h-[78vh] max-w-full object-contain"
            />
          ) : (
            <div className="p-8 text-sm text-gray-400">Generated output is not available for preview.</div>
          )}
          {hasMultiple && (
            <button
              onClick={() => setIndex((currentIndex) => Math.min(outputs.length - 1, currentIndex + 1))}
              disabled={index === outputs.length - 1}
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-gray-900/80 p-2 text-gray-100 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next generated image"
              title="Next"
            >
              <ChevronRight size={24} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default GeneratedOutputModal;
