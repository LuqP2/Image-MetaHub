import React, { useState, useMemo, useEffect } from 'react';
import SearchBar, { SearchField } from './SearchBar';

interface SidebarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchField: SearchField;
  onSearchFieldChange: (field: SearchField) => void;
  availableModels: string[];
  availableLoras: string[];
  availableSchedulers: string[];
  selectedModels: string[];
  selectedLoras: string[];
  selectedSchedulers: string[];
  onModelChange: (models: string[]) => void;
  onLoraChange: (loras: string[]) => void;
  onSchedulerChange: (schedulers: string[]) => void;
  onClearAllFilters: () => void;
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
  selectedModels,
  selectedLoras,
  selectedSchedulers,
  onModelChange,
  onLoraChange,
  onSchedulerChange,
  onClearAllFilters,
  children,
  isCollapsed,
  onToggleCollapse
}) => {

  const [expandedSections, setExpandedSections] = useState({
    models: true,
    loras: true,
    schedulers: true
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
      <div className="fixed left-0 top-0 h-full w-12 bg-gray-800 border-r border-gray-700 z-40 flex flex-col items-center py-4 transition-all duration-300 ease-in-out">
        <button
          onClick={onToggleCollapse}
          className="text-gray-400 hover:text-white transition-colors mb-4"
          title="Expand sidebar"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className="flex flex-col space-y-2">
          {(selectedModels.length > 0 || selectedLoras.length > 0 || selectedSchedulers.length > 0) && (
            <div className="w-2 h-2 bg-blue-500 rounded-full" title="Active filters"></div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed left-0 top-0 h-full w-80 bg-gray-800 border-r border-gray-700 z-40 flex flex-col transition-all duration-300 ease-in-out">
      {/* Header with collapse button */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-gray-200">Filters</h2>
        <button
          onClick={onToggleCollapse}
          className="text-gray-400 hover:text-white transition-colors"
          title="Collapse sidebar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
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

      {/* Render children, which will be the DirectoryList */}
      {children}

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Models Section */}
        {availableModels.length > 0 && (
          <div className="border-b border-gray-700">
            <button
              onClick={() => toggleSection('models')}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span className="text-gray-300 font-medium">Models</span>
                <span className="text-xs bg-blue-600 text-blue-100 px-2 py-1 rounded">
                  {availableModels.length}
                </span>
                {selectedModels.length > 0 && (
                  <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded">
                    {selectedModels.length} selected
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                {selectedModels.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearSection('models');
                    }}
                    className="text-xs text-gray-400 hover:text-red-400"
                    title="Clear model filters"
                  >
                    ✕
                  </button>
                )}
                <svg
                  className={`w-4 h-4 transform transition-transform ${expandedSections.models ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {expandedSections.models && (
              <div className="px-4 pb-4 max-h-64 overflow-y-auto">
                {availableModels.map((model, index) => (
                  <label key={`model-${index}-${model}`} className="flex items-center space-x-2 py-2 hover:bg-gray-700/30 px-2 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedModels.includes(model)}
                      onChange={(e) => handleModelToggle(model, e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
                    />
                    <span className="text-gray-200 text-sm flex-1 truncate" title={model}>{model}</span>
                  </label>
                ))}
              </div>
            )}
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
                <span className="text-xs bg-purple-600 text-purple-100 px-2 py-1 rounded">
                  {availableLoras.length}
                </span>
                {selectedLoras.length > 0 && (
                  <span className="text-xs bg-purple-500 text-white px-2 py-1 rounded">
                    {selectedLoras.length} selected
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                {selectedLoras.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearSection('loras');
                    }}
                    className="text-xs text-gray-400 hover:text-red-400"
                    title="Clear LoRA filters"
                  >
                    ✕
                  </button>
                )}
                <svg
                  className={`w-4 h-4 transform transition-transform ${expandedSections.loras ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {expandedSections.loras && (
              <div className="px-4 pb-4 max-h-64 overflow-y-auto">
                {availableLoras.map((lora, index) => (
                  <label key={`lora-${index}-${lora}`} className="flex items-center space-x-2 py-2 hover:bg-gray-700/30 px-2 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedLoras.includes(lora)}
                      onChange={(e) => handleLoraToggle(lora, e.target.checked)}
                      className="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500 focus:ring-2"
                    />
                    <span className="text-gray-200 text-sm flex-1 truncate" title={lora}>{lora}</span>
                  </label>
                ))}
              </div>
            )}
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
                <span className="text-xs bg-green-600 text-green-100 px-2 py-1 rounded">
                  {availableSchedulers.length}
                </span>
                {selectedSchedulers.length > 0 && (
                  <span className="text-xs bg-green-500 text-white px-2 py-1 rounded">
                    {selectedSchedulers.length} selected
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                {selectedSchedulers.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearSection('schedulers');
                    }}
                    className="text-xs text-gray-400 hover:text-red-400"
                    title="Clear scheduler filters"
                  >
                    ✕
                  </button>
                )}
                <svg
                  className={`w-4 h-4 transform transition-transform ${expandedSections.schedulers ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {expandedSections.schedulers && (
              <div className="px-4 pb-4 max-h-64 overflow-y-auto">
                {availableSchedulers.map((scheduler, index) => (
                  <label key={`scheduler-${index}-${scheduler}`} className="flex items-center space-x-2 py-2 hover:bg-gray-700/30 px-2 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedSchedulers.includes(scheduler)}
                      onChange={(e) => handleSchedulerToggle(scheduler, e.target.checked)}
                      className="w-4 h-4 text-green-600 bg-gray-700 border-gray-600 rounded focus:ring-green-500 focus:ring-2"
                    />
                    <span className="text-gray-200 text-sm flex-1 truncate" title={scheduler}>{scheduler}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Clear All Filters */}
      {(selectedModels.length > 0 || selectedLoras.length > 0 || selectedSchedulers.length > 0) && (
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={onClearAllFilters}
            className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
          >
            Clear All Filters
          </button>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
