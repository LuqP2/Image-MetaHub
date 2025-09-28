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
  advancedFilters: any;
  onAdvancedFiltersChange: (filters: any) => void;
  onClearAllFilters: () => void;
  images: any[]; // Add images prop for data extraction
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
  advancedFilters,
  onAdvancedFiltersChange,
  onClearAllFilters,
  images
}) => {
  const [expandedSections, setExpandedSections] = useState({
    models: false,
    loras: false,
    schedulers: false,
    advanced: false
  });

  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load advanced section state from localStorage
  useEffect(() => {
    const savedAdvancedExpanded = localStorage.getItem('invokeai-advanced-expanded');
    if (savedAdvancedExpanded !== null) {
      setExpandedSections(prev => ({
        ...prev,
        advanced: JSON.parse(savedAdvancedExpanded)
      }));
    }
  }, []);

  // Save advanced section state to localStorage
  useEffect(() => {
    localStorage.setItem('invokeai-advanced-expanded', JSON.stringify(expandedSections.advanced));
  }, [expandedSections.advanced]);

  // Advanced filters state
  const [selectedDimension, setSelectedDimension] = useState('');
  const [stepsRange, setStepsRange] = useState({ min: 0, max: 100 });
  const [cfgRange, setCfgRange] = useState({ min: 1, max: 20 });
  const [dateRange, setDateRange] = useState({ from: '', to: '' });

  const extractUniqueData = (images: any[]) => {
    const dimensions = images.reduce((acc, img) => {
      const width = img.metadata?.width || img.metadata?.image?.width || img.metadata?.controlLayers?.find(layer => layer.image)?.image?.width || img.width || 'undefined';
      const height = img.metadata?.height || img.metadata?.image?.height || img.metadata?.controlLayers?.find(layer => layer.image)?.image?.height || img.height || 'undefined';
      const key = `${width}×${height}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const sortedDimensions = Object.entries(dimensions)
      .map(([key, value]) => {
        const [width, height] = key.split('×').map(Number);
        return { key, value: value as number, size: width * height };
      })
      .sort((a, b) => b.size - a.size);

    const steps = images.map(img => img.metadata?.steps || img.metadata?.num_inference_steps).filter(Boolean);
    const minSteps = steps.length ? Math.min(...steps) : 0;
    const maxSteps = steps.length ? Math.max(...steps) : 100;

    const cfgScales = images.map(img => img.metadata?.cfgScale || img.metadata?.guidance_scale).filter(Boolean);
    const minCfg = cfgScales.length ? Math.min(...cfgScales) : 1;
    const maxCfg = cfgScales.length ? Math.max(...cfgScales) : 20;

    const dates = images.map(img => img.lastModified).filter(Boolean);
    const minDate = dates.length ? new Date(Math.min(...dates)).toISOString().split('T')[0] : '';
    const maxDate = dates.length ? new Date(Math.max(...dates)).toISOString().split('T')[0] : '';

    return { dimensions: sortedDimensions, minSteps, maxSteps, minCfg, maxCfg, minDate, maxDate };
  };

  const uniqueData = useMemo(() => extractUniqueData(images), [images]);
  const { minSteps, maxSteps, minCfg, maxCfg, minDate, maxDate } = uniqueData;

  useEffect(() => {
    setStepsRange({ min: minSteps || 0, max: maxSteps || 100 });
    setCfgRange({ min: minCfg || 1, max: maxCfg || 20 });
    setDateRange({ from: minDate || '', to: maxDate || '' });
  }, [minSteps, maxSteps, minCfg, maxCfg, minDate, maxDate]);

  const handleDimensionChange = (value: string) => {
    setSelectedDimension(value);
    onAdvancedFiltersChange({ ...advancedFilters, dimension: value });
  };

  const handleStepsChange = (type: 'min' | 'max', value: number) => {
    const newRange = { ...stepsRange, [type]: value };
    setStepsRange(newRange);
    onAdvancedFiltersChange({ ...advancedFilters, steps: newRange });
  };

  const handleCfgChange = (type: 'min' | 'max', value: number) => {
    const newRange = { ...cfgRange, [type]: value };
    setCfgRange(newRange);
    onAdvancedFiltersChange({ ...advancedFilters, cfg: newRange });
  };

  const handleDateChange = (type: 'from' | 'to', value: string) => {
    const newRange = { ...dateRange, [type]: value };
    setDateRange(newRange);
    onAdvancedFiltersChange({ ...advancedFilters, date: newRange });
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

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
      <div className="fixed left-0 top-0 h-full w-12 bg-gray-800 border-r border-gray-700 z-40 flex flex-col items-center py-4">
        <button
          onClick={() => setIsCollapsed(false)}
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
    <div className="fixed left-0 top-0 h-full w-80 bg-gray-800 border-r border-gray-700 z-40 flex flex-col">
      {/* Header with collapse button */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-gray-200">Filters</h2>
        <button
          onClick={() => setIsCollapsed(true)}
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

        {/* Advanced Filters Section */}
        <div className="border-b border-gray-700">
          <button
            onClick={() => toggleSection('advanced')}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
          >
            <span className="text-gray-300 font-medium">Advanced Filters</span>
            <svg
              className={`w-4 h-4 transform transition-transform ${expandedSections.advanced ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expandedSections.advanced && (
            <div className="px-4 pb-4 space-y-4">
              {/* Dimensions Dropdown */}
              <div>
                <label className="text-gray-400 text-sm mb-2 block">Dimensions</label>
                <select
                  value={selectedDimension}
                  onChange={(e) => handleDimensionChange(e.target.value)}
                  className="w-full bg-gray-700 text-gray-200 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
                >
                  <option value="">All Dimensions</option>
                  {uniqueData.dimensions.map(({ key, value }) => (
                    <option key={key} value={key}>
                      {key} ({value.toLocaleString()} images)
                    </option>
                  ))}
                </select>
              </div>

              {/* Steps Range Slider */}
              <div>
                <label className="text-gray-400 text-sm mb-2 block">Generation Steps</label>
                <div className="mb-2">
                  <label className="text-gray-400 text-sm mb-2 block">Steps: {stepsRange.min}-{stepsRange.max}</label>
                  <div className="flex items-center space-x-4">
                    <input
                      type="range"
                      min={minSteps || 0}
                      max={maxSteps || 100}
                      value={stepsRange.min}
                      onChange={(e) => handleStepsChange('min', Number(e.target.value))}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="range"
                      min={minSteps || 0}
                      max={maxSteps || 100}
                      value={stepsRange.max}
                      onChange={(e) => handleStepsChange('max', Number(e.target.value))}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* CFG Scale Range Slider */}
              <div>
                <label className="text-gray-400 text-sm mb-2 block">CFG Scale</label>
                <div className="mb-2">
                  <label className="text-gray-400 text-sm mb-2 block">CFG: {cfgRange.min.toFixed(1)}-{cfgRange.max.toFixed(1)}</label>
                  <div className="flex items-center space-x-4">
                    <input
                      type="range"
                      min={minCfg || 1}
                      max={maxCfg || 20}
                      step="0.1"
                      value={cfgRange.min}
                      onChange={(e) => handleCfgChange('min', Number(e.target.value))}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="range"
                      min={minCfg || 1}
                      max={maxCfg || 20}
                      step="0.1"
                      value={cfgRange.max}
                      onChange={(e) => handleCfgChange('max', Number(e.target.value))}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Date Range Inputs */}
              <div>
                <label className="text-gray-400 text-sm mb-2 block">Date Range</label>
                <div className="flex items-center space-x-4">
                  <div className="flex flex-col">
                    <span className="text-gray-400 text-sm mb-1">From: {formatDate(dateRange.from)}</span>
                    <input
                      type="date"
                      value={dateRange.from}
                      onChange={(e) => handleDateChange('from', e.target.value)}
                      className="bg-gray-700 text-gray-200 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-gray-400 text-sm mb-1">To: {formatDate(dateRange.to)}</span>
                    <input
                      type="date"
                      value={dateRange.to}
                      onChange={(e) => handleDateChange('to', e.target.value)}
                      className="bg-gray-700 text-gray-200 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
                    />
                  </div>
                </div>
              </div>

              {/* Clear Advanced Filters Button */}
              {(selectedDimension || (stepsRange.min !== (minSteps || 0) || stepsRange.max !== (maxSteps || 100)) || (cfgRange.min !== (minCfg || 1) || cfgRange.max !== (maxCfg || 20)) || dateRange.from || dateRange.to) && (
                <div className="flex justify-end mt-4 pt-3 border-t border-gray-600">
                  <button
                    onClick={() => {
                      setSelectedDimension('');
                      setStepsRange({ min: minSteps || 0, max: maxSteps || 100 });
                      setCfgRange({ min: minCfg || 1, max: maxCfg || 20 });
                      setDateRange({ from: minDate || '', to: maxDate || '' });
                      onAdvancedFiltersChange({});
                    }}
                    className="bg-gray-600 hover:bg-gray-500 text-gray-200 px-4 py-2 rounded-lg text-sm transition-colors duration-200 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                    aria-label="Clear all advanced filters"
                  >
                    Clear Advanced
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
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