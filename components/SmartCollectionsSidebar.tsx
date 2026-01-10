import React, { useMemo, useState } from 'react';
import { Box, Tag, User } from 'lucide-react';
import { SmartCollection } from '../types';

export interface SmartCollectionSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  collections: SmartCollection[];
  emptyLabel?: string;
}

interface SmartCollectionsSidebarProps {
  sections: SmartCollectionSection[];
  selectedCollectionId: string | null;
  onSelectCollection: (collection: SmartCollection | null) => void;
}

const SmartCollectionsSidebar: React.FC<SmartCollectionsSidebarProps> = ({
  sections,
  selectedCollectionId,
  onSelectCollection,
}) => {
  const [filter, setFilter] = useState('');

  const filteredSections = useMemo(() => {
    const normalized = filter.trim().toLowerCase();
    if (!normalized) {
      return sections;
    }
    return sections.map((section) => ({
      ...section,
      collections: section.collections.filter((collection) =>
        collection.name.toLowerCase().includes(normalized)
      ),
    }));
  }, [sections, filter]);

  return (
    <aside className="h-full bg-gray-900/60 border border-gray-800 rounded-2xl p-4 flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-100">Collections</h3>
        <p className="text-[11px] text-gray-400 mt-1">
          Filter stacks by model, style, or your custom groups.
        </p>
      </div>

      <div className="flex items-center gap-2 bg-gray-900/70 border border-gray-800 rounded-lg px-2 py-1.5">
        <span className="text-gray-500 text-xs">Filter</span>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search collections..."
          className="bg-transparent text-xs text-gray-200 placeholder-gray-500 flex-1 focus:outline-none"
        />
      </div>

      <button
        type="button"
        onClick={() => onSelectCollection(null)}
        className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
          selectedCollectionId === null
            ? 'bg-blue-500/20 text-blue-200 border-blue-500/40'
            : 'bg-gray-900/60 text-gray-300 border-gray-800 hover:bg-gray-800/80'
        }`}
      >
        <span>All stacks</span>
        <span className="text-[10px] text-gray-400">∞</span>
      </button>

      <div className="flex-1 overflow-y-auto space-y-4">
        {filteredSections.map((section) => (
          <div key={section.id} className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-400">
              {section.icon}
              <span>{section.label}</span>
            </div>
            {section.collections.length === 0 ? (
              <p className="text-[11px] text-gray-500">{section.emptyLabel ?? 'No collections yet.'}</p>
            ) : (
              <div className="space-y-1">
                {section.collections.map((collection) => {
                  const isActive = collection.id === selectedCollectionId;
                  return (
                    <button
                      key={collection.id}
                      type="button"
                      onClick={() => onSelectCollection(collection)}
                      className={`w-full flex items-center justify-between text-left px-3 py-2 rounded-lg text-xs border transition-colors ${
                        isActive
                          ? 'bg-purple-500/20 text-purple-200 border-purple-500/40'
                          : 'bg-gray-900/50 text-gray-300 border-gray-800 hover:bg-gray-800/70'
                      }`}
                    >
                      <span className="truncate">{collection.name}</span>
                      <span className="text-[10px] text-gray-400">{collection.imageCount}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
};

export default SmartCollectionsSidebar;

export const sectionIcons = {
  model: <Box className="w-3.5 h-3.5" />,
  style: <Tag className="w-3.5 h-3.5" />,
  custom: <User className="w-3.5 h-3.5" />,
};
