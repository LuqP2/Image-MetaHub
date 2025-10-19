import React, { useState, useMemo, useEffect } from 'react';
import SearchBar, { SearchField } from './SearchBar';
import AdvancedFilters from './AdvancedFilters';
import { ChevronLeft, ChevronRight, X, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface SidebarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchField: SearchField;
  onSearchFieldChange: (field: SearchField) => void;
  availableModels: string[];
  availableLoras: string[];
  availableSchedulers: string[];
  availableDimensions: string[];
  selectedModels: string[];
  selectedLoras: string[];
  selectedSchedulers: string[];
  onModelChange: (models: string[]) => void;
  onLoraChange: (loras: string[]) => void;
  onSchedulerChange: (schedulers: string[]) => void;
  onClearAllFilters: () => void;
  advancedFilters: any;
  onAdvancedFiltersChange: (filters: any) => void;
  onClearAdvancedFilters: () => void;
  children?: React.ReactNode;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  searchQuery,
  onSearchChange,
  searchField,
  onSearchFieldChange,
  availableModels,
  availableLoras,
  availableSchedulers,
  availableDimensions,
  selectedModels,
  selectedLoras,
  selectedSchedulers,
  onModelChange,
  onLoraChange,
  onSchedulerChange,
  onClearAllFilters,
  advancedFilters,
  onAdvancedFiltersChange,
  onClearAdvancedFilters,
  children,
  isCollapsed,
  onToggleCollapse
}) => {

  const [expandedSections, setExpandedSections] = useState({
    models: true,
    loras: true,
    schedulers: true,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleModelToggle = (model: string, checked: boolean) => {
    if (checked) {
      onModelChange([...selectedModels, model]);
    } else {
      onModelChange(selectedModels.filter(m => m !== model));
    }
  };

  const handleLoraToggle = (lora: string, checked: boolean) => {
    if (checked) {
      onLoraChange([...selectedLoras, lora]);
    } else {
      onLoraChange(selectedLoras.filter(l => l !== lora));
    }
  };

  const handleSchedulerToggle = (scheduler: string, checked: boolean) => {
    if (checked) {
      onSchedulerChange([...selectedSchedulers, scheduler]);
    } else {
      onSchedulerChange(selectedSchedulers.filter(s => s !== scheduler));
    }
  };

  const clearSection = (section: 'models' | 'loras' | 'schedulers') => {
    switch (section) {
      case 'models':
        onModelChange([]);
        break;
      case 'loras':
        onLoraChange([]);
        break;
      case 'schedulers':
        onSchedulerChange([]);
        break;
    }
  };

  if (isCollapsed) {
    return (
      <div
        data-area="sidebar"
        tabIndex={-1}
        className="fixed left-0 top-0 h-full w-12 bg-gray-800/80 backdrop-blur-sm border-r border-gray-700 z-40 flex flex-col items-center py-4 transition-all duration-300 ease-in-out">
        <button
          onClick={onToggleCollapse}
          className="text-gray-400 hover:text-white transition-colors mb-4 hover:shadow-lg hover:shadow-accent/30 rounded-full p-1"
          title="Expand sidebar"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
        <div className="flex flex-col space-y-2">
          {(selectedModels.length > 0 || selectedLoras.length > 0 || selectedSchedulers.length > 0) && (
            <div className="w-2 h-2 bg-accent rounded-full" title="Active filters"></div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-area="sidebar"
      tabIndex={-1}
      className="fixed left-0 top-0 h-full w-80 bg-gray-800/80 backdrop-blur-sm border-r border-gray-700 z-40 flex flex-col transition-all duration-300 ease-in-out">
      {/* Header with collapse button */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-gray-200">Filters</h2>
        <button
          onClick={onToggleCollapse}
          className="text-gray-400 hover:text-white transition-colors hover:shadow-lg hover:shadow-accent/30 rounded-full p-1"
          title="Collapse sidebar"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      </div>

      {/* Search Bar */}
      <div className="p-4 border-b border-gray-700">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          searchField={searchField}
          onSearchFieldChange={onSearchFieldChange}
        />
      </div>

      {/* Scrollable Content - includes DirectoryList AND Filters */}
      <div className="flex-1 overflow-y-auto scrollbar-sidebar">
        {/* Render children, which will be the DirectoryList */}
        {children}

        {/* Models Section */}
        {availableModels.length > 0 && (
          <div className="border-b border-gray-700">
            <button
              onClick={() => toggleSection('models')}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span className="text-gray-300 font-medium">Models</span>
                <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded border border-gray-600">
                  {availableModels.length}
                </span>
                {selectedModels.length > 0 && (
                  <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded border border-blue-700/50">
                    {selectedModels.length} selected
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                {selectedModels.length > 0 && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      clearSection('models');
                    }}
                    className="text-xs text-gray-400 hover:text-red-400 cursor-pointer"
                    title="Clear model filters"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        clearSection('models');
                      }
                    }}
                  >
                    <X size={16} />
                  </span>
                )}
                <ChevronDown
                  className={`w-4 h-4 transform transition-transform ${expandedSections.models ? 'rotate-180' : ''}`}
                />
              </div>
            </button>
            <AnimatePresence>
              {expandedSections.models && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 max-h-64 overflow-y-auto scrollbar-thin">
                    {availableModels
                      .filter(model => typeof model === 'string' && model.trim() !== '')
                      .map((model, index) => (
                      <label key={`model-${index}-${model}`} className="flex items-center space-x-2 py-2 hover:bg-gray-700/30 px-2 rounded-lg cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedModels.includes(model)}
                          onChange={(e) => handleModelToggle(model, e.target.checked)}
                          className="w-4 h-4 text-accent bg-gray-700 border-gray-600 rounded-md focus:ring-accent focus:ring-2"
                        />
                        <span className="text-gray-200 text-sm flex-1 truncate" title={model}>{model}</span>
                      </label>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* LoRAs Section */}
        {availableLoras.length > 0 && (
          <div className="border-b border-gray-700">
            <button
              onClick={() => toggleSection('loras')}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span className="text-gray-300 font-medium">LoRAs</span>
                <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded border border-gray-600">
                  {availableLoras.length}
                </span>
                {selectedLoras.length > 0 && (
                  <span className="text-xs bg-purple-900/40 text-purple-300 px-2 py-0.5 rounded border border-purple-700/50">
                    {selectedLoras.length} selected
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                {selectedLoras.length > 0 && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      clearSection('loras');
                    }}
                    className="text-xs text-gray-400 hover:text-red-400 cursor-pointer"
                    title="Clear LoRA filters"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        clearSection('loras');
                      }
                    }}
                  >
                    <X size={16} />
                  </span>
                )}
                <ChevronDown
                  className={`w-4 h-4 transform transition-transform ${expandedSections.loras ? 'rotate-180' : ''}`}
                />
              </div>
            </button>
            <AnimatePresence>
              {expandedSections.loras && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 max-h-64 overflow-y-auto scrollbar-thin">
                    {availableLoras
                      .filter(lora => typeof lora === 'string' && lora.trim() !== '')
                      .map((lora, index) => (
                      <label key={`lora-${index}-${lora}`} className="flex items-center space-x-2 py-2 hover:bg-gray-700/30 px-2 rounded-lg cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedLoras.includes(lora)}
                          onChange={(e) => handleLoraToggle(lora, e.target.checked)}
                          className="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded-md focus:ring-purple-500 focus:ring-2"
                        />
                        <span className="text-gray-200 text-sm flex-1 truncate" title={lora}>{lora}</span>
                      </label>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Schedulers Section */}
        {availableSchedulers.length > 0 && (
          <div className="border-b border-gray-700">
            <button
              onClick={() => toggleSection('schedulers')}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span className="text-gray-300 font-medium">Schedulers</span>
                <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded border border-gray-600">
                  {availableSchedulers.length}
                </span>
                {selectedSchedulers.length > 0 && (
                  <span className="text-xs bg-green-900/40 text-green-300 px-2 py-0.5 rounded border border-green-700/50">
                    {selectedSchedulers.length} selected
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                {selectedSchedulers.length > 0 && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      clearSection('schedulers');
                    }}
                    className="text-xs text-gray-400 hover:text-red-400 cursor-pointer"
                    title="Clear scheduler filters"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        clearSection('schedulers');
                      }
                    }}
                  >
                    <X size={16} />
                  </span>
                )}
                <ChevronDown
                  className={`w-4 h-4 transform transition-transform ${expandedSections.schedulers ? 'rotate-180' : ''}`}
                />
              </div>
            </button>
            <AnimatePresence>
              {expandedSections.schedulers && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 max-h-64 overflow-y-auto scrollbar-thin">
                    {availableSchedulers
                      .filter(scheduler => typeof scheduler === 'string' && scheduler.trim() !== '')
                      .map((scheduler, index) => (
                      <label key={`scheduler-${index}-${scheduler}`} className="flex items-center space-x-2 py-2 hover:bg-gray-700/30 px-2 rounded-lg cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedSchedulers.includes(scheduler)}
                          onChange={(e) => handleSchedulerToggle(scheduler, e.target.checked)}
                          className="w-4 h-4 text-green-600 bg-gray-700 border-gray-600 rounded-md focus:ring-green-500 focus:ring-2"
                        />
                        <span className="text-gray-200 text-sm flex-1 truncate" title={scheduler}>{scheduler}</span>
                      </label>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Advanced Filters */}
        <AdvancedFilters
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={onAdvancedFiltersChange}
          onClearAdvancedFilters={onClearAdvancedFilters}
          availableDimensions={availableDimensions}
        />
      </div>

      {/* Clear All Filters */}
      {(selectedModels.length > 0 || selectedLoras.length > 0 || selectedSchedulers.length > 0 || Object.keys(advancedFilters || {}).length > 0) && (
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={onClearAllFilters}
            className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm transition-all duration-200 hover:shadow-lg hover:shadow-red-600/30"
          >
            Clear All Filters
          </button>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
