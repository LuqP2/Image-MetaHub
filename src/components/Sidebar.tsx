import React, { useState, ReactNode } from 'react';
import { SearchField } from './SearchBar';

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center p-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-100 focus:outline-none"
      >
        <span>{title}</span>
        <span>{isOpen ? '▼' : '▶'}</span>
      </button>
      {isOpen && (
        <div className="p-2">
          {children}
        </div>
      )}
    </div>
  );
};


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
  children: ReactNode; // For DirectoryList
}

const FilterList: React.FC<{ items: string[]; selectedItems: string[]; onChange: (items: string[]) => void; }> = ({ items, selectedItems, onChange }) => {
  const handleToggle = (item: string) => {
    const newSelection = selectedItems.includes(item)
      ? selectedItems.filter(i => i !== item)
      : [...selectedItems, item];
    onChange(newSelection);
  };

  return (
    <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
      {items.map(item => (
        <label key={item} className="flex items-center space-x-2 text-sm text-gray-800 cursor-pointer hover:bg-gray-100 rounded p-1">
          <input
            type="checkbox"
            checked={selectedItems.includes(item)}
            onChange={() => handleToggle(item)}
            className="h-3.5 w-3.5 rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="truncate" title={item}>{item}</span>
        </label>
      ))}
    </div>
  );
};


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
  return (
    <aside className="w-60 flex-shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col">
      <div className="p-2 border-b border-gray-200">
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        <CollapsibleSection title="Directories" defaultOpen={true}>
          {children}
        </CollapsibleSection>
        <CollapsibleSection title={`Models (${selectedModels.length})`}>
          <FilterList items={availableModels} selectedItems={selectedModels} onChange={onModelChange} />
        </CollapsibleSection>
        <CollapsibleSection title={`Loras (${selectedLoras.length})`}>
          <FilterList items={availableLoras} selectedItems={selectedLoras} onChange={onLoraChange} />
        </CollapsibleSection>
        <CollapsibleSection title={`Schedulers (${selectedSchedulers.length})`}>
          <FilterList items={availableSchedulers} selectedItems={selectedSchedulers} onChange={onSchedulerChange} />
        </CollapsibleSection>
      </div>
       <div className="p-2 border-t border-gray-200">
        <button
            onClick={onClearAllFilters}
            className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
            Clear All Filters
        </button>
       </div>
    </aside>
  );
};

export default Sidebar;