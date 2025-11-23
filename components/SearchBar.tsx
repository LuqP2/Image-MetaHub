
import React from 'react';

export type SearchField = 'any' | 'prompt' | 'negativePrompt' | 'seed';

interface SearchBarProps {
  value: string;
  onChange: (query: string) => void;
  searchField: SearchField;
  onSearchFieldChange: (field: SearchField) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  searchField,
  onSearchFieldChange
}) => {
  const searchOptions = [
    { value: 'any' as SearchField, label: 'Any Field', placeholder: 'Search images...' },
    { value: 'prompt' as SearchField, label: 'Prompt', placeholder: 'Search prompts...' },
    { value: 'negativePrompt' as SearchField, label: 'Negative Prompt', placeholder: 'Search negative prompts...' },
    { value: 'seed' as SearchField, label: 'Seed', placeholder: 'Search seeds...' },
  ];

  const currentOption = searchOptions.find(option => option.value === searchField);

  return (
    <div className="relative w-full">
      <div className="flex flex-wrap gap-2 sm:flex-nowrap">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={currentOption?.placeholder || 'Search images...'}
            className="w-full bg-gray-700 text-gray-200 placeholder-gray-400 py-2 pl-10 pr-4 rounded-lg border-2 border-transparent focus:outline-none focus:border-blue-500 transition-colors"
            data-testid="search-input"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Search Field Dropdown */}
        <div className="relative w-full sm:w-auto">
          <select
            value={searchField}
            onChange={(e) => onSearchFieldChange(e.target.value as SearchField)}
            className="bg-gray-700 text-gray-200 py-2 px-3 pr-8 rounded-lg border-2 border-transparent focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer min-w-[120px]"
          >
            {searchOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchBar;
