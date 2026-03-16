import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Plus, Tag } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';

interface TagManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedImageIds: string[];
}

const TagManagerModal: React.FC<TagManagerModalProps> = ({
  isOpen,
  onClose,
  selectedImageIds,
}) => {
  const { availableTags, bulkAddTag, bulkRemoveTag, images } = useImageStore();
  const [inputValue, setInputValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Determine which tags are present on the selected images
  // We want to show:
  // 1. Tags present on ALL selected images (common tags)
  // 2. Tags present on SOME selected images (mixed tags) - maybe distinctive style?
  
  const selectedImages = useMemo(() => {
    const selectedSet = new Set(selectedImageIds);
    return images.filter(img => selectedSet.has(img.id));
  }, [images, selectedImageIds]);

  const existingTagsStats = useMemo(() => {
    const stats = new Map<string, number>();
    selectedImages.forEach(img => {
      img.tags?.forEach(tag => {
        stats.set(tag, (stats.get(tag) || 0) + 1);
      });
    });
    return stats;
  }, [selectedImages]);

  const sortedExistingTags = useMemo(() => {
    return Array.from(existingTagsStats.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by frequency
      .map(([tag, count]) => ({
        name: tag,
        count,
        isAll: count === selectedImages.length
      }));
  }, [existingTagsStats, selectedImages.length]);

  // Filter suggestions based on input (last part after comma)
  const suggestions = useMemo(() => {
    if (!inputValue.trim()) return [];
    
    const parts = inputValue.split(',');
    const currentSearch = parts[parts.length - 1].trim().toLowerCase();
    
    if (!currentSearch) return [];

    return availableTags
      .filter(tag => 
        tag.name.toLowerCase().includes(currentSearch) && 
        !existingTagsStats.has(tag.name)
      )
      .slice(0, 5);
  }, [inputValue, availableTags, existingTagsStats]);

  const handleAddTag = async (input: string) => {
    if (!input.trim()) return;
    
    const tagsToAdd = input.split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    if (tagsToAdd.length === 0) return;

    setIsSubmitting(true);
    try {
      for (const tag of tagsToAdd) {
          // Store handles duplicates per image, so we just send the request
          await bulkAddTag(selectedImageIds, tag);
      }
      setInputValue('');
      // Keep modal open for more tagging
    } catch (error) {
      console.error('Failed to add tags:', error);
    } finally {
      setIsSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const handleSuggestionClick = (tagName: string) => {
    const parts = inputValue.split(',');
    parts.pop(); // Remove the partial chunk
    parts.push(tagName); // Add the selected tag
    // Join with comma and space, and add a trailing comma space for convenience to type next
    const newValue = parts.map(p => p.trim()).join(', ') + ', ';
    setInputValue(newValue);
    inputRef.current?.focus();
  };

  const handleRemoveTag = async (tag: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    
    // Use timeout to allow event loop to clear before blocking with confirm
    // This often helps with focus/event issues around native dialogs
    setTimeout(async () => {
        if (!confirm(`Remove tag "${tag}" from ${selectedImages.length} images?`)) {
            inputRef.current?.focus();
            return;
        }
        
        setIsSubmitting(true);
        try {
          await bulkRemoveTag(selectedImageIds, tag);
        } catch (error) {
          console.error('Failed to remove tag:', error);
        } finally {
          setIsSubmitting(false);
          // Force focus restoration
          setTimeout(() => {
             inputRef.current?.focus();
          }, 0);
        }
    }, 10);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim()) {
        handleAddTag(inputValue);
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-800/50">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold text-white">
              Manage Tags 
              <span className="ml-2 text-sm font-normal text-gray-400">
                ({selectedImageIds.length} selected)
              </span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar flex-1">
          
          {/* Input Section */}
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type tags separated by commas..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2.5 text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none"
              autoComplete="off"
            />
            <button
              onClick={() => handleAddTag(inputValue)}
              disabled={!inputValue.trim() || isSubmitting}
              className="absolute right-1.5 top-1.5 p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus size={16} />
            </button>

            {/* Suggestions Dropdown */}
            {suggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                {suggestions.map(tag => (
                  <button
                    key={tag.name}
                    onClick={() => handleSuggestionClick(tag.name)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white flex justify-between items-center group"
                  >
                    <span>{tag.name}</span>
                    <span className="text-xs text-gray-500 group-hover:text-gray-400">{tag.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Existing Tags List */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Current Tags
            </h3>
            
            {sortedExistingTags.length === 0 ? (
              <div className="text-center py-4 text-gray-500 text-sm italic">
                No tags on selected images.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sortedExistingTags.map(({ name, count, isAll }) => (
                  <div
                    key={name}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-sm transition-colors group ${
                      isAll 
                        ? 'bg-blue-900/30 border-blue-700/50 text-blue-200' 
                        : 'bg-gray-800 border-gray-700 text-gray-300 border-dashed'
                    }`}
                    title={isAll ? 'Present on all selected images' : `Present on ${count} of ${selectedImages.length} images`}
                  >
                    <span className="max-w-[150px] truncate">{name}</span>
                    {!isAll && (
                       <span className="text-[10px] bg-gray-700 px-1 rounded-full text-gray-400">
                         {count}
                       </span>
                    )}
                    <button
                      onClick={(e) => handleRemoveTag(name, e)}
                      className="ml-1 text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="mt-4 p-3 bg-gray-800/50 rounded-lg text-xs text-gray-400 border border-gray-700/50">
             <p>Tip: Separate tags with commas. Press Enter to add.</p>
             {sortedExistingTags.some(t => !t.isAll) && (
               <p className="mt-1 text-yellow-500/80">
                 * Dashed tags are only present on some selected images.
               </p>
             )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 bg-gray-900 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors font-medium text-sm border border-gray-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default TagManagerModal;
