import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, X, Calendar, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface AdvancedFiltersProps {
  advancedFilters: any;
  onAdvancedFiltersChange: (filters: any) => void;
  onClearAdvancedFilters: () => void;
  availableDimensions: string[];
}

const AdvancedFilters: React.FC<AdvancedFiltersProps> = ({
  advancedFilters,
  onAdvancedFiltersChange,
  onClearAdvancedFilters,
  availableDimensions
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localFilters, setLocalFilters] = useState(advancedFilters || {});

  useEffect(() => {
    setLocalFilters(advancedFilters || {});
  }, [advancedFilters]);

  const updateFilter = (key: string, value: any) => {
    const newFilters = { ...localFilters, [key]: value };
    // Remove empty filters
    Object.keys(newFilters).forEach(k => {
      if (newFilters[k] === null || newFilters[k] === undefined) {
        delete newFilters[k];
      }
      // For date objects, check if both from and to are empty
      if (k === 'date' && typeof newFilters[k] === 'object') {
        const dateObj = newFilters[k];
        if ((!dateObj.from || dateObj.from === '') && (!dateObj.to || dateObj.to === '')) {
          delete newFilters[k];
        }
      }
      // For other objects, remove if empty
      else if (typeof newFilters[k] === 'object' && Object.keys(newFilters[k]).length === 0) {
        delete newFilters[k];
      }
    });
    
    setLocalFilters(newFilters);
    onAdvancedFiltersChange(newFilters);
  };

  const hasActiveFilters = Object.keys(advancedFilters || {}).length > 0;

  return (
    <div className="border-b border-gray-700">
      <div className="w-full flex items-center justify-between p-4">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 flex items-center justify-between hover:bg-gray-700/50 transition-colors -m-4 p-4"
        >
          <div className="flex items-center space-x-2">
            <Settings className="w-4 h-4 text-gray-400" />
            <span className="text-gray-300 font-medium">Advanced Filters</span>
            {hasActiveFilters && (
              <span className="text-xs bg-purple-600 text-purple-100 px-2 py-1 rounded-lg">
                {Object.keys(advancedFilters).length} active
              </span>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        {hasActiveFilters && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearAdvancedFilters();
            }}
            className="ml-2 text-xs text-gray-400 hover:text-red-400 p-1"
            title="Clear advanced filters"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">

              {/* Dimensions Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Dimensions
                </label>
                <select
                  value={localFilters.dimension || ''}
                  onChange={(e) => updateFilter('dimension', e.target.value || null)}
                  className="w-full bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 text-sm"
                >
                  <option value="">All dimensions</option>
                  {availableDimensions.map(dim => (
                    <option key={dim} value={dim}>{dim}</option>
                  ))}
                </select>
              </div>

              {/* Steps Range */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Steps Range: {localFilters.steps ? `${localFilters.steps.min} - ${localFilters.steps.max}` : 'All'}
                </label>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    placeholder="Min"
                    value={localFilters.steps?.min || ''}
                    onChange={(e) => {
                      const min = parseInt(e.target.value) || 0;
                      const max = localFilters.steps?.max || 100;
                      updateFilter('steps', { min: Math.max(0, min), max: Math.max(min + 1, max) });
                    }}
                    className="flex-1 bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 text-sm"
                    min="0"
                    max="100"
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    value={localFilters.steps?.max || ''}
                    onChange={(e) => {
                      const max = parseInt(e.target.value) || 100;
                      const min = localFilters.steps?.min || 0;
                      updateFilter('steps', { min: Math.min(min, max - 1), max: Math.min(100, max) });
                    }}
                    className="flex-1 bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 text-sm"
                    min="0"
                    max="100"
                  />
                </div>
              </div>

              {/* CFG Scale Range */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  CFG Scale: {localFilters.cfg ? `${localFilters.cfg.min} - ${localFilters.cfg.max}` : 'All'}
                </label>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    placeholder="Min"
                    step="0.1"
                    value={localFilters.cfg?.min || ''}
                    onChange={(e) => {
                      const min = parseFloat(e.target.value) || 0;
                      const max = localFilters.cfg?.max || 20;
                      updateFilter('cfg', { min: Math.max(0, min), max: Math.max(min + 0.1, max) });
                    }}
                    className="flex-1 bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 text-sm"
                    min="0"
                    max="20"
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    step="0.1"
                    value={localFilters.cfg?.max || ''}
                    onChange={(e) => {
                      const max = parseFloat(e.target.value) || 20;
                      const min = localFilters.cfg?.min || 0;
                      updateFilter('cfg', { min: Math.min(min, max - 0.1), max: Math.min(20, max) });
                    }}
                    className="flex-1 bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 text-sm"
                    min="0"
                    max="20"
                  />
                </div>
              </div>

              {/* Date Range */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center text-sm font-medium text-gray-300">
                    <Calendar className="w-4 h-4 mr-1" />
                    Date Range
                  </label>
                  {(localFilters.date?.from || localFilters.date?.to) && (
                    <button
                      onClick={() => updateFilter('date', null)}
                      className="text-xs text-gray-400 hover:text-red-400"
                      title="Clear date range"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">From</label>
                    <input
                      type="date"
                      value={localFilters.date?.from || ''}
                      onChange={(e) => {
                        const newFrom = e.target.value;
                        const currentTo = localFilters.date?.to || '';
                        
                        // Only create date object if at least one field has a value
                        if (!newFrom && !currentTo) {
                          updateFilter('date', null);
                        } else {
                          updateFilter('date', { 
                            from: newFrom || '', 
                            to: currentTo || '' 
                          });
                        }
                      }}
                      className="w-full bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">To</label>
                    <input
                      type="date"
                      value={localFilters.date?.to || ''}
                      onChange={(e) => {
                        const newTo = e.target.value;
                        const currentFrom = localFilters.date?.from || '';
                        
                        // Only create date object if at least one field has a value
                        if (!currentFrom && !newTo) {
                          updateFilter('date', null);
                        } else {
                          updateFilter('date', { 
                            from: currentFrom || '', 
                            to: newTo || '' 
                          });
                        }
                      }}
                      className="w-full bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 text-sm"
                    />
                  </div>
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdvancedFilters;
