import React, { useState, useEffect } from 'react';
import { X, Save, Tag } from 'lucide-react';
import { usePromptStore } from '../store/usePromptStore';
import { PromptPreset } from '../types';

const SavePresetModal: React.FC = () => {
  const { isSaveModalOpen, closeSaveModal, pendingSaveMetadata, addPreset } = usePromptStore();
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');

  // Reset form when modal opens with new metadata
  useEffect(() => {
    if (isSaveModalOpen && pendingSaveMetadata) {
      // Suggest a name from the prompt (first few words)
      const suggestedName = pendingSaveMetadata.prompt
        ? pendingSaveMetadata.prompt.slice(0, 30).replace(/\n/g, ' ').trim() + (pendingSaveMetadata.prompt.length > 30 ? '...' : '')
        : 'New Preset';
      setName(suggestedName);
      setTags('');
    }
  }, [isSaveModalOpen, pendingSaveMetadata]);

  if (!isSaveModalOpen || !pendingSaveMetadata) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);

    const newPreset: PromptPreset = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: Date.now(),
      prompt: pendingSaveMetadata.prompt || '',
      negativePrompt: pendingSaveMetadata.negativePrompt,
      model: pendingSaveMetadata.model,
      steps: pendingSaveMetadata.steps,
      cfg: pendingSaveMetadata.cfg_scale || pendingSaveMetadata.cfg,
      width: pendingSaveMetadata.width,
      height: pendingSaveMetadata.height,
      sampler: pendingSaveMetadata.sampler,
      scheduler: pendingSaveMetadata.scheduler,
      tags: tagList
    };

    await addPreset(newPreset);
    closeSaveModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800/50">
          <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
            <Save className="w-5 h-5 text-blue-400" />
            Save Preset
          </h2>
          <button 
            onClick={closeSaveModal}
            className="text-gray-400 hover:text-gray-200 transition-colors p-1 rounded-full hover:bg-gray-700"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Preset Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder-gray-600"
              placeholder="My Awesome Prompt"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              <span className="flex items-center gap-1.5">
                <Tag size={14} />
                Tags (comma separated)
              </span>
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder-gray-600"
              placeholder="portrait, realistic, outdoor"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeSaveModal}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-500/20"
            >
              Save Preset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SavePresetModal;
