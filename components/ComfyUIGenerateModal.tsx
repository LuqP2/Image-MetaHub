/**
 * ComfyUI Generation Modal
 * Supports original-workflow and simple rebuild generation modes.
 */

import React, { useEffect, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import hotkeyManager from '../services/hotkeyManager';
import { type IndexedImage } from '../types';
import ComfyUIWorkflowWorkspace, {
  type GenerationParams,
  sanitizeStoredModelForWorkflowMode,
} from './ComfyUIWorkflowWorkspace';

interface ComfyUIGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  image: IndexedImage;
  onGenerate: (params: GenerationParams) => Promise<void>;
  isGenerating: boolean;
}

export { sanitizeStoredModelForWorkflowMode };
export type { GenerationParams };

export const ComfyUIGenerateModal: React.FC<ComfyUIGenerateModalProps> = ({
  isOpen,
  onClose,
  image,
  onGenerate,
  isGenerating,
}) => {
  const { canUseComfyUI } = useFeatureAccess();
  const [isExpandedModal, setIsExpandedModal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      hotkeyManager.pauseHotkeys();
    } else {
      hotkeyManager.resumeHotkeys();
    }

    return () => {
      hotkeyManager.resumeHotkeys();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setIsExpandedModal(false);
    }
  }, [isOpen]);

  if (!isOpen || !canUseComfyUI) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex flex-col rounded-lg bg-gray-800 p-6 text-gray-100 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: isExpandedModal ? 'min(96vw, 1680px)' : 'min(92vw, 1320px)',
          height: isExpandedModal ? '92vh' : '88vh',
          maxHeight: '92vh',
          minHeight: '720px',
          resize: 'both',
          overflow: 'hidden',
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Generate with ComfyUI</h2>
            <p className="text-sm text-gray-400">
              Inspect the embedded workflow, edit supported values, and generate variations without leaving MetaHub.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpandedModal((current) => !current)}
              className="rounded-full p-2 text-gray-300 hover:bg-gray-700"
              title={isExpandedModal ? 'Restore modal size' : 'Expand modal'}
            >
              {isExpandedModal ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-700" aria-label="Close generate modal">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          <ComfyUIWorkflowWorkspace
            image={image}
            onGenerate={onGenerate}
            isGenerating={isGenerating}
            defaultTab="parameters"
            viewportHeight={isExpandedModal ? 720 : 560}
            onCancel={onClose}
            showCancelButton
          />
        </div>
      </div>
    </div>
  );
};

export default ComfyUIGenerateModal;
