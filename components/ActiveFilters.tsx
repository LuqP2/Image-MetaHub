import React from 'react';
import { useImageStore } from '../store/useImageStore';
import { X, CheckCircle, Calendar, Settings } from 'lucide-react';

const ActiveFilters: React.FC = () => {
    const selectedModels = useImageStore((state) => state.selectedModels);
    const selectedLoras = useImageStore((state) => state.selectedLoras);
    const selectedSchedulers = useImageStore((state) => state.selectedSchedulers);
    const selectedTags = useImageStore((state) => state.selectedTags);
    const searchQuery = useImageStore((state) => state.searchQuery);
    const showFavoritesOnly = useImageStore((state) => state.showFavoritesOnly);
    const advancedFilters = useImageStore((state) => state.advancedFilters);

    const setSelectedFilters = useImageStore((state) => state.setSelectedFilters);
    const setSelectedTags = useImageStore((state) => state.setSelectedTags);
    const setSearchQuery = useImageStore((state) => state.setSearchQuery);
    const setShowFavoritesOnly = useImageStore((state) => state.setShowFavoritesOnly);
    const setAdvancedFilters = useImageStore((state) => state.setAdvancedFilters);

    const hasActiveFilters = 
        selectedModels.length > 0 ||
        selectedLoras.length > 0 ||
        selectedSchedulers.length > 0 ||
        selectedTags.length > 0 ||
        !!searchQuery ||
        showFavoritesOnly ||
        (advancedFilters && Object.keys(advancedFilters).length > 0);

    if (!hasActiveFilters) {
        return null;
    }

    const removeModel = (model: string) => {
        setSelectedFilters({
            models: selectedModels.filter((m) => m !== model),
        });
    };

    const removeLora = (lora: string) => {
        setSelectedFilters({
            loras: selectedLoras.filter((l) => l !== lora),
        });
    };

    const removeScheduler = (scheduler: string) => {
        setSelectedFilters({
            schedulers: selectedSchedulers.filter((s) => s !== scheduler),
        });
    };

    const removeTag = (tag: string) => {
        setSelectedTags(selectedTags.filter((t) => t !== tag));
    };

    const clearSearch = () => {
        setSearchQuery('');
    };

    const clearFavorites = () => {
        setShowFavoritesOnly(false);
    };

    const removeAdvancedFilter = (key: string) => {
        const newFilters = { ...advancedFilters };
        delete newFilters[key];
        setAdvancedFilters(newFilters);
    };

    return (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 px-2 flex-nowrap mask-linear-fade">
            {/* Search Query Tag */}
            {searchQuery && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-200 border border-gray-600 flex-shrink-0 animate-fade-in group">
                    <span className="opacity-70 group-hover:opacity-100 transition-opacity">Search:</span>
                    <span className="max-w-[150px] truncate">"{searchQuery}"</span>
                    <button
                        onClick={clearSearch}
                        className="ml-1 hover:text-white rounded-full hover:bg-gray-600 p-0.5 transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* Favorites Tag */}
            {showFavoritesOnly && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-yellow-900/40 text-yellow-200 border border-yellow-700/50 flex-shrink-0 animate-fade-in">
                     <span>★ Favorites</span>
                    <button
                        onClick={clearFavorites}
                        className="ml-1 hover:text-yellow-100 rounded-full hover:bg-yellow-800/50 p-0.5 transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* Verified Telemetry Tag */}
            {advancedFilters?.hasVerifiedTelemetry && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-900/40 text-green-200 border border-green-700/50 flex-shrink-0 animate-fade-in">
                    <CheckCircle size={10} />
                    <span>Verified Only</span>
                    <button
                        onClick={() => removeAdvancedFilter('hasVerifiedTelemetry')}
                        className="ml-1 hover:text-green-100 rounded-full hover:bg-green-800/50 p-0.5 transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* Dimensions Tag */}
            {advancedFilters?.dimension && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-indigo-900/40 text-indigo-200 border border-indigo-700/50 flex-shrink-0 animate-fade-in">
                    <Settings size={10} />
                    <span>{advancedFilters.dimension}</span>
                    <button
                        onClick={() => removeAdvancedFilter('dimension')}
                        className="ml-1 hover:text-indigo-100 rounded-full hover:bg-indigo-800/50 p-0.5 transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* Steps Tag */}
            {advancedFilters?.steps && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-indigo-900/40 text-indigo-200 border border-indigo-700/50 flex-shrink-0 animate-fade-in">
                    <Settings size={10} />
                    <span>Steps: {advancedFilters.steps.min}-{advancedFilters.steps.max}</span>
                    <button
                        onClick={() => removeAdvancedFilter('steps')}
                        className="ml-1 hover:text-indigo-100 rounded-full hover:bg-indigo-800/50 p-0.5 transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* CFG Tag */}
            {advancedFilters?.cfg && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-indigo-900/40 text-indigo-200 border border-indigo-700/50 flex-shrink-0 animate-fade-in">
                    <Settings size={10} />
                    <span>CFG: {advancedFilters.cfg.min}-{advancedFilters.cfg.max}</span>
                    <button
                        onClick={() => removeAdvancedFilter('cfg')}
                        className="ml-1 hover:text-indigo-100 rounded-full hover:bg-indigo-800/50 p-0.5 transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* Date Tag */}
            {advancedFilters?.date && (
                 <div className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-indigo-900/40 text-indigo-200 border border-indigo-700/50 flex-shrink-0 animate-fade-in">
                    <Calendar size={10} />
                    <span>
                        {advancedFilters.date.from || '...'} - {advancedFilters.date.to || '...'}
                    </span>
                    <button
                        onClick={() => removeAdvancedFilter('date')}
                        className="ml-1 hover:text-indigo-100 rounded-full hover:bg-indigo-800/50 p-0.5 transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* Model Tags - Blue */}
            {selectedModels.map((model) => (
                <div
                    key={`model-${model}`}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-900/40 text-blue-200 border border-blue-700/50 flex-shrink-0 animate-fade-in"
                    title="Model"
                >
                    <span className="truncate max-w-[150px]">{model}</span>
                    <button
                        onClick={() => removeModel(model)}
                        className="ml-1 hover:text-blue-100 rounded-full hover:bg-blue-800/50 p-0.5 transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            ))}

            {/* LoRA Tags - Purple */}
            {selectedLoras.map((lora) => (
                <div
                    key={`lora-${lora}`}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-900/40 text-purple-200 border border-purple-700/50 flex-shrink-0 animate-fade-in"
                    title="LoRA"
                >
                    <span className="truncate max-w-[150px]">{lora}</span>
                    <button
                        onClick={() => removeLora(lora)}
                        className="ml-1 hover:text-purple-100 rounded-full hover:bg-purple-800/50 p-0.5 transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            ))}

            {/* Scheduler Tags - Cyan/Teal */}
            {selectedSchedulers.map((scheduler) => (
                <div
                    key={`scheduler-${scheduler}`}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-teal-900/40 text-teal-200 border border-teal-700/50 flex-shrink-0 animate-fade-in"
                    title="Scheduler"
                >
                    <span className="truncate max-w-[150px]">{scheduler}</span>
                    <button
                        onClick={() => removeScheduler(scheduler)}
                        className="ml-1 hover:text-teal-100 rounded-full hover:bg-teal-800/50 p-0.5 transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            ))}

            {/* General Tags - Gray */}
            {selectedTags.map((tag) => (
                <div
                    key={`tag-${tag}`}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-700/60 text-gray-300 border border-gray-600 flex-shrink-0 animate-fade-in"
                >
                    <span className="opacity-70">#</span>
                    <span className="truncate max-w-[150px]">{tag}</span>
                    <button
                        onClick={() => removeTag(tag)}
                        className="ml-1 hover:text-white rounded-full hover:bg-gray-600 p-0.5 transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            ))}
        </div>
    );
};

export default ActiveFilters;
