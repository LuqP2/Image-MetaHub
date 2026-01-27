import React, { useState, useMemo } from 'react';
import { X, Search, Trash2, Copy, Calendar, FileText, Settings2, Sliders, Check } from 'lucide-react';
import { usePromptStore } from '../store/usePromptStore';

const PromptLibraryModal: React.FC = () => {
  const { isLibraryOpen, closeLibrary, presets, removePreset, onSelect } = usePromptStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* Hook order fix: Hooks must be called before conditional returns */
  const filteredPresets = useMemo(() => {
    if (!searchQuery.trim()) return presets;
    const lowerQuery = searchQuery.toLowerCase();
    return presets.filter(p => 
      p.name.toLowerCase().includes(lowerQuery) ||
      p.prompt.toLowerCase().includes(lowerQuery) ||
      p.tags?.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }, [presets, searchQuery]);

  if (!isLibraryOpen) return null;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could add toast here
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, { 
      year: 'numeric', month: 'short', day: 'numeric' 
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800">
          <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <Settings2 className="w-6 h-6 text-purple-400" />
            Prompt Library
          </h2>
          <button 
            onClick={closeLibrary}
            className="text-gray-400 hover:text-gray-200 transition-colors p-2 rounded-full hover:bg-gray-700"
          >
            <X size={24} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-4 bg-gray-800/50 border-b border-gray-700 flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search presets by name, prompt, or tags..."
              className="w-full bg-gray-950 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all placeholder-gray-500"
            />
          </div>
          <div className="text-gray-400 text-sm flex items-center">
            {filteredPresets.length} presets
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-900/50 custom-scrollbar">
          {filteredPresets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3 opacity-60">
              <FileText size={48} />
              <p className="text-lg font-medium">No presets found</p>
              <p className="text-sm">Save a prompt from the sidebar to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredPresets.map(preset => (
                <div 
                  key={preset.id} 
                  className={`bg-gray-800 border border-gray-700 rounded-lg overflow-hidden transition-all duration-200 hover:border-gray-600 ${
                    expandedId === preset.id ? 'ring-1 ring-purple-500/50' : ''
                  }`}
                >
                  {/* Card Header (Always visible) */}
                  <div 
                    className="p-4 cursor-pointer flex items-start gap-4 hover:bg-gray-800/80"
                    onClick={() => setExpandedId(expandedId === preset.id ? null : preset.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base font-semibold text-gray-200 truncate pr-2">{preset.name}</h3>
                        {preset.tags && preset.tags.map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-blue-900/40 text-blue-300 border border-blue-800/50 flex-shrink-0">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <p className="text-sm text-gray-400 line-clamp-2 font-mono leading-relaxed opacity-80">
                        {preset.prompt}
                      </p>
                      
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />
                          {formatDate(preset.createdAt)}
                        </span>
                        {(preset.width && preset.height) && (
                          <span className="flex items-center gap-1">
                            <Sliders size={12} />
                            {preset.width}x{preset.height}
                          </span>
                        )}
                        {preset.model && (
                            <span className="truncate max-w-[150px]" title={preset.model}>{preset.model}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      {onSelect && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(preset);
                            closeLibrary();
                          }}
                          className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors shadow-lg shadow-blue-900/20"
                          title="Load Preset"
                        >
                          <Check size={16} />
                        </button>
                      )}
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(preset.prompt);
                        }}
                        className="p-2 bg-gray-700 hover:bg-blue-600 text-gray-300 hover:text-white rounded-md transition-colors"
                        title="Copy Prompt"
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedId === preset.id && (
                    <div className="px-4 pb-4 pt-0 bg-gray-900/30 border-t border-gray-700/50 animate-in slide-in-from-top-2 duration-200">
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                           <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Positive Prompt</label>
                           <div className="bg-black/30 p-3 rounded-md border border-gray-700/50 relative group">
                              <p className="text-sm text-gray-300 font-mono whitespace-pre-wrap">{preset.prompt}</p>
                              <button 
                                onClick={() => copyToClipboard(preset.prompt)}
                                className="absolute top-2 right-2 p-1.5 bg-gray-700 text-gray-400 hover:text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Copy"
                              >
                                <Copy size={12} />
                              </button>
                           </div>
                        </div>
                        {preset.negativePrompt && (
                            <div className="space-y-2">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Negative Prompt</label>
                            <div className="bg-black/30 p-3 rounded-md border border-gray-700/50 relative group">
                                <p className="text-sm text-red-100/70 font-mono whitespace-pre-wrap">{preset.negativePrompt}</p>
                                <button 
                                    onClick={() => copyToClipboard(preset.negativePrompt!)}
                                    className="absolute top-2 right-2 p-1.5 bg-gray-700 text-gray-400 hover:text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Copy"
                                >
                                    <Copy size={12} />
                                </button>
                            </div>
                            </div>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-400 bg-black/20 p-2 rounded border border-gray-700/30">
                        {preset.steps && <span className="bg-gray-800 px-2 py-1 rounded">Steps: {preset.steps}</span>}
                        {preset.cfg && <span className="bg-gray-800 px-2 py-1 rounded">CFG: {preset.cfg}</span>}
                        {preset.sampler && <span className="bg-gray-800 px-2 py-1 rounded">Sampler: {preset.sampler}</span>}
                        {preset.scheduler && <span className="bg-gray-800 px-2 py-1 rounded">Scheduler: {preset.scheduler}</span>}
                        {preset.model && <span className="bg-gray-800 px-2 py-1 rounded">Model: {preset.model}</span>}
                      </div>

                      <div className="mt-4 flex justify-end gap-2">
                         <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                if(confirm('Are you sure you want to delete this preset?')) {
                                    removePreset(preset.id);
                                }
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-900/20 text-red-400 hover:bg-red-900/40 hover:text-red-300 rounded border border-red-900/30 transition-colors text-sm"
                         >
                            <Trash2 size={14} />
                            Delete
                         </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 bg-gray-800 text-xs text-center text-gray-500">
          Pro Tip: Click on a card to view full details and generation parameters.
        </div>
      </div>
    </div>
  );
};

export default PromptLibraryModal;
