
import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Save } from 'lucide-react';
import { ShadowMetadata, ShadowResource } from '../types';

interface MetadataEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMetadata: ShadowMetadata | null;
  onSave: (metadata: ShadowMetadata) => Promise<void>;
  imageId: string;
}

export const MetadataEditorModal: React.FC<MetadataEditorModalProps> = ({
  isOpen,
  onClose,
  initialMetadata,
  onSave,
  imageId,
}) => {
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [resources, setResources] = useState<ShadowResource[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize form when opening
  useEffect(() => {
    if (isOpen) {
      setPrompt(initialMetadata?.prompt || '');
      setNegativePrompt(initialMetadata?.negativePrompt || '');
      setSeed(initialMetadata?.seed);
      setWidth(initialMetadata?.width);
      setHeight(initialMetadata?.height);
      setDuration(initialMetadata?.duration);
      setNotes(initialMetadata?.notes || '');
      setResources(initialMetadata?.resources || []);
    }
  }, [isOpen, initialMetadata]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const newMetadata: ShadowMetadata = {
        imageId, // Ensure we keep the correct ID
        prompt: prompt || undefined,
        negativePrompt: negativePrompt || undefined,
        seed: seed,
        width: width,
        height: height,
        duration: duration,
        notes: notes || undefined,
        resources: resources.length > 0 ? resources : undefined,
        updatedAt: Date.now(),
      };

      await onSave(newMetadata);
      onClose();
    } catch (error) {
      console.error('Failed to save metadata:', error);
      alert('Failed to save metadata');
    } finally {
      setIsSaving(false);
    }
  };

  const addResource = () => {
    const newResource: ShadowResource = {
      id: crypto.randomUUID(),
      type: 'model',
      name: '',
      weight: 1.0,
    };
    setResources([...resources, newResource]);
  };

  const removeResource = (id: string) => {
    setResources(resources.filter((r) => r.id !== id));
  };

  const updateResource = (id: string, field: keyof ShadowResource, value: any) => {
    setResources(
      resources.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-blue-400">Edit Metadata</span>
            <span className="text-xs font-normal text-gray-500 bg-gray-800 px-2 py-1 rounded">
              Overrides only
            </span>
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          
          {/* Section 1: Essentials */}
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-300 border-b border-gray-800 pb-2">
              Essentials
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="col-span-1 md:col-span-2 space-y-2">
                <label className="text-sm font-medium text-gray-400">Prompt</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none text-sm min-h-[100px]"
                  placeholder="Enter positive prompt..."
                />
              </div>

              <div className="col-span-1 md:col-span-2 space-y-2">
                <label className="text-sm font-medium text-gray-400">Negative Prompt</label>
                <textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-red-200/80 focus:ring-2 focus:ring-red-500/50 focus:border-red-500 outline-none text-sm min-h-[80px]"
                  placeholder="Enter negative prompt..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-400">Seed</label>
                <input
                  type="number"
                  value={seed ?? ''}
                  onChange={(e) => setSeed(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="123456789"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-400">Duration (sec)</label>
                 <input
                  type="number"
                  value={duration ?? ''}
                  onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="For videos (e.g. 5.5)"
                  step="0.1"
                />
              </div>

               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-400">Width</label>
                    <input
                      type="number"
                      value={width ?? ''}
                      onChange={(e) => setWidth(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="1024"
                    />
                 </div>
                 <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-400">Height</label>
                    <input
                      type="number"
                      value={height ?? ''}
                      onChange={(e) => setHeight(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="1024"
                    />
                 </div>
               </div>
            </div>
          </section>

          {/* Section 2: Resources */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <h3 className="text-lg font-semibold text-gray-300">Resources</h3>
              <button
                onClick={addResource}
                className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition-colors"
              >
                <Plus size={14} /> Add Resource
              </button>
            </div>
            
            <div className="space-y-3">
              {resources.length === 0 && (
                <div className="text-center py-6 text-gray-500 text-sm italic">
                  No models or LoRAs added yet.
                </div>
              )}
              
              {resources.map((res) => (
                <div key={res.id} className="flex items-start gap-3 bg-gray-800/30 p-3 rounded-lg border border-gray-700/50 group">
                   <div className="w-32 flex-shrink-0">
                      <select
                        value={res.type}
                        onChange={(e) => updateResource(res.id, 'type', e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 outline-none focus:border-blue-500"
                      >
                        <option value="model">Model</option>
                        <option value="lora">LoRA</option>
                        <option value="embedding">Embedding</option>
                      </select>
                   </div>
                   
                   <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        value={res.name}
                        onChange={(e) => updateResource(res.id, 'name', e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500"
                        placeholder="Resource Name (e.g. SDXL Base 1.0)"
                      />
                   </div>

                   <div className="w-24 flex-shrink-0">
                      <input
                        type="number"
                        value={res.weight ?? 1}
                        onChange={(e) => updateResource(res.id, 'weight', parseFloat(e.target.value))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500 text-center"
                        step="0.1"
                        placeholder="Weight"
                      />
                   </div>

                   <button
                    onClick={() => removeResource(res.id)}
                    className="text-gray-500 hover:text-red-400 p-1.5 transition-colors opacity-0 group-hover:opacity-100"
                    title="Remove resource"
                   >
                     <Trash2 size={16} />
                   </button>
                </div>
              ))}
            </div>
          </section>

          {/* Section 3: Workflow / Notes */}
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-300 border-b border-gray-800 pb-2">
              Workflow & Notes
            </h3>
             <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none text-sm min-h-[120px] font-mono"
                placeholder="Describe your workflow, settings, or any other notes here..."
              />
          </section>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 flex justify-end gap-3 bg-gray-900 rounded-b-xl">
           <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              'Saving...'
            ) : (
              <>
                <Save size={16} /> Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
