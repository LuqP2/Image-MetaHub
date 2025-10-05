import React from 'react';

// Helper component for filter groups to keep the main component clean
const FilterGroup = ({ title, items, selectedItems, onSelectionChange }) => {
  if (!items || items.length === 0) {
    return null;
  }

  const handleToggle = (item: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedItems, item]);
    } else {
      onSelectionChange(selectedItems.filter(i => i !== item));
    }
  };

  return (
    <div className="mb-4">
      <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">{title}</h3>
      <div className="max-h-40 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-sm p-2 bg-white dark:bg-gray-900">
        {items.map((item) => (
          <label key={item} className="flex items-center text-sm mb-1 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedItems.includes(item)}
              onChange={(e) => handleToggle(item, e.target.checked)}
              className="mr-2 h-4 w-4 rounded-sm border-gray-400 dark:border-gray-500 focus:ring-blue-500"
            />
            <span className="truncate" title={item}>{item}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

interface SidebarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
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
}

const Sidebar: React.FC<SidebarProps> = ({
  searchQuery,
  onSearchChange,
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
  children
}) => {
  const inputStyle = `
    w-full p-2 rounded-sm border
    bg-white text-black
    border-gray-300 dark:border-gray-600
    dark:bg-gray-800 dark:text-gray-100
    focus:outline-none focus:ring-2 focus:ring-blue-500
  `;

  const buttonStyle = `
    w-full mt-2 px-4 py-2 rounded-sm
    bg-gray-200 text-black
    dark:bg-gray-700 dark:text-gray-100
    hover:bg-gray-300 dark:hover:bg-gray-600
    focus:outline-none focus:ring-2 focus:ring-blue-500
  `;

  const hasActiveFilters = selectedModels.length > 0 || selectedLoras.length > 0 || selectedSchedulers.length > 0;

  return (
    <aside className="fixed top-12 left-0 h-[calc(100vh-3rem)] w-80 bg-gray-100 dark:bg-gray-800 border-r border-gray-300 dark:border-gray-700 z-30 flex flex-col">
      <div className="p-4 border-b border-gray-300 dark:border-gray-700">
        <label htmlFor="search" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Search</label>
        <input
          type="text"
          id="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className={inputStyle}
          placeholder="Filter by any metadata..."
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <FilterGroup
          title="Models"
          items={availableModels}
          selectedItems={selectedModels}
          onSelectionChange={onModelChange}
        />
        <FilterGroup
          title="LoRAs"
          items={availableLoras}
          selectedItems={selectedLoras}
          onSelectionChange={onLoraChange}
        />
        <FilterGroup
          title="Schedulers"
          items={availableSchedulers}
          selectedItems={selectedSchedulers}
          onSelectionChange={onSchedulerChange}
        />
      </div>

      <div className="p-4 border-t border-gray-300 dark:border-gray-700">
        {hasActiveFilters && (
          <button onClick={onClearAllFilters} className={buttonStyle}>
            Clear All Filters
          </button>
        )}
        <div className="mt-4">
          <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Folders</h3>
          {children}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;