import React, { useState, useMemo, useEffect } from 'react';

interface AdvancedFiltersProps {
  images: any[];
  onFiltersChange: (filters: any) => void;
  currentFilters: any;
}

const AdvancedFilters: React.FC<AdvancedFiltersProps> = ({
  images,
  onFiltersChange,
  currentFilters,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
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

    const cfgScales = images.map(img => img.metadata?.cfg_scale || img.metadata?.guidance_scale).filter(Boolean);
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

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  const handleDimensionChange = (value: string) => {
    setSelectedDimension(value);
    onFiltersChange({ ...currentFilters, dimension: value });
  };

  const handleStepsChange = (type: 'min' | 'max', value: number) => {
    const newRange = { ...stepsRange, [type]: value };
    setStepsRange(newRange);
    onFiltersChange({ ...currentFilters, steps: newRange });
  };

  const handleCfgChange = (type: 'min' | 'max', value: number) => {
    const newRange = { ...cfgRange, [type]: value };
    setCfgRange(newRange);
    onFiltersChange({ ...currentFilters, cfg: newRange });
  };

  const handleDateChange = (type: 'from' | 'to', value: string) => {
    const newRange = { ...dateRange, [type]: value };
    setDateRange(newRange);
    onFiltersChange({ ...currentFilters, date: newRange });
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  return (
    <div className="w-full bg-gray-800/30 rounded-lg mt-4 px-6">
      <div
        className="cursor-pointer flex items-center justify-between px-3 py-2 border border-gray-700 hover:bg-gray-700/50 transition-colors duration-200 rounded-lg"
        onClick={toggleExpanded}
      >
        <h3 className="text-gray-300 text-sm font-medium">Advanced Filters</h3>
        <button className="focus:outline-none ml-2">
          <svg
            className={`w-4 h-4 transform transition-transform duration-300 ${
              isExpanded ? 'rotate-180' : 'rotate-0'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isExpanded && (
        <div
          className="mt-2 p-4 bg-gray-800/95 rounded-lg border border-gray-600 shadow-xl transition-opacity duration-300"
          style={{ height: isExpanded ? 'auto' : '0', opacity: isExpanded ? 1 : 0 }}
        >
          <div className="flex flex-col sm:flex-row gap-4 w-full">
            {/* Placeholder for filter components */}
            <div className="flex-1">
              <label className="text-gray-400 text-sm mb-2 block">📐 Dimensions</label>
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
            <div className="flex-1">
              <label className="text-gray-400 text-sm mb-2 block">📊 Generation Steps</label>
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
            <div className="flex-1">
              <label className="text-gray-400 text-sm mb-2 block">⚙️ CFG Scale</label>
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
            <div className="flex-1">
              <label className="text-gray-400 text-sm mb-2 block">📅 Date Range</label>
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
                  onFiltersChange({});
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
  );
};

export default AdvancedFilters;