import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Search, X } from 'lucide-react';
import type { ModelPromptOverlapGroup } from '../services/similarImageSearch';

interface ModelPromptPickerModalProps {
  isOpen: boolean;
  modelName: string | null;
  groups: ModelPromptOverlapGroup[];
  onClose: () => void;
  onSelect: (group: ModelPromptOverlapGroup) => void;
}

export default function ModelPromptPickerModal({
  isOpen,
  modelName,
  groups,
  onClose,
  onSelect,
}: ModelPromptPickerModalProps) {
  if (!isOpen || !modelName || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[151] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Find matching prompts">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-gray-100">Find matching prompts</div>
            <div className="text-sm text-gray-400">
              Prompt groups in <span className="font-medium text-cyan-200">{modelName}</span> that also exist under other checkpoints.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-700 p-2 text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
            aria-label="Close prompt picker"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {groups.length === 0 ? (
            <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-950/50 px-6 text-center">
              <Search className="mb-3 h-6 w-6 text-gray-500" />
              <div className="text-sm font-semibold text-gray-200">No overlapping prompts found</div>
              <div className="mt-2 max-w-lg text-xs leading-relaxed text-gray-400">
                This checkpoint does not currently share exact normalized prompts with any alternate checkpoint in the indexed library.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <button
                  key={`${group.normalizedPrompt}-${group.sourceImage.id}`}
                  type="button"
                  onClick={() => onSelect(group)}
                  className="flex w-full items-center justify-between gap-4 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4 text-left transition-colors hover:border-cyan-400/60 hover:bg-cyan-500/10"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-100" title={group.sourceImage.prompt || group.promptPreview}>
                      {group.promptPreview}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-400">
                      <span className="rounded-full border border-gray-700 px-2 py-1">
                        {group.sourceCount} in this checkpoint
                      </span>
                      <span className="rounded-full border border-cyan-500/40 px-2 py-1 text-cyan-200">
                        {group.alternateCheckpointCount} alternate checkpoint{group.alternateCheckpointCount === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200">
                    Open
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
