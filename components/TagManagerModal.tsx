import { useTranslation } from '../i18n/useTranslation';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Plus, Tag } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import TagInputCombobox from './TagInputCombobox';
import { getRecentTagChips } from '../utils/tagSuggestions';

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
  const { t } = useTranslation();
  const { availableTags, bulkAddTag, bulkRemoveTag, images } = useImageStore();
  const recentTags = useImageStore((state) => state.recentTags);
  const tagSuggestionLimit = useSettingsStore((state) => state.tagSuggestionLimit);
  const recentTagChipLimit = useSettingsStore((state) => state.recentTagChipLimit);
  const [inputValue, setInputValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingRemoveTag, setPendingRemoveTag] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = () => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setInputValue('');
      setIsSubmitting(false);
      setPendingRemoveTag(null);
      focusInput();
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

  const tagsOnAllSelected = useMemo(
    () => sortedExistingTags.filter(t => t.isAll).map(t => t.name),
    [sortedExistingTags]
  );

  const quickAddSuggestions = useMemo(() => getRecentTagChips({
    recentTags,
    excludedTags: tagsOnAllSelected,
    limit: recentTagChipLimit,
  }), [recentTags, tagsOnAllSelected, recentTagChipLimit]);

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
      focusInput();
    }
  };

  const handleApplySingleTag = async (tag: string) => {
    if (!tag.trim()) return;

    setIsSubmitting(true);
    try {
      await bulkAddTag(selectedImageIds, tag);
      setInputValue('');
    } catch (error) {
      console.error('Failed to add tag:', error);
    } finally {
      setIsSubmitting(false);
      focusInput();
    }
  };

  const handleApplyExistingTag = async (tag: string) => {
    await handleApplySingleTag(tag);
  };

  const handleRemoveTagRequest = (tag: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setPendingRemoveTag(tag);
  };

  const handleConfirmRemoveTag = async () => {
    if (!pendingRemoveTag) {
      return;
    }

    setIsSubmitting(true);
    try {
      await bulkRemoveTag(selectedImageIds, pendingRemoveTag);
    } catch (error) {
      console.error('Failed to remove tag:', error);
    } finally {
      setIsSubmitting(false);
      setPendingRemoveTag(null);
      focusInput();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (pendingRemoveTag) {
        setPendingRemoveTag(null);
        focusInput();
        return;
      }
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
              {t('fileOperations.manageTags')}<span className="ml-2 text-sm font-normal text-gray-400">
                {t('fileOperations.selected', { count: selectedImageIds.length })}
              </span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label={t('fileOperations.closeTags')}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar flex-1">
          
          {/* Input Section */}
          <div className="relative">
            <TagInputCombobox
              ref={inputRef}
              value={inputValue}
              onValueChange={setInputValue}
              onSubmit={handleAddTag}
              onSelectSuggestion={handleApplySingleTag}
              recentTags={recentTags}
              availableTags={availableTags}
              excludedTags={[]}
              suggestionLimit={tagSuggestionLimit}
              mode="csv"
              placeholder={t('fileOperations.tagsComma')}
              onEscape={() => {
                if (pendingRemoveTag) {
                  setPendingRemoveTag(null);
                  focusInput();
                  return;
                }

                onClose();
              }}
              wrapperClassName="relative"
              inputClassName="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2.5 text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none"
              dropdownClassName="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow-xl"
              metaClassName="text-xs text-gray-500"
              trailingContent={
                <button
                  type="button"
                  onClick={() => handleAddTag(inputValue)}
                  onKeyDown={handleKeyDown}
                  disabled={!inputValue.trim() || isSubmitting}
                  className="absolute right-1.5 top-1.5 p-1.5 bg-blue-600 hover:bg-blue-500 text-white hover:text-gray-950 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  aria-label={t('promptLibrary.addTags')}
                >
                  <Plus size={16} />
                </button>
              }
            />
          </div>

          {/* Quick-add: recently used tags */}
          {inputValue.trim().length === 0 && quickAddSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {quickAddSuggestions.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => void handleApplySingleTag(tag)}
                  disabled={isSubmitting}
                  className="text-xs bg-gray-700/30 text-gray-400 px-1.5 py-0.5 rounded hover:bg-gray-600 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {pendingRemoveTag && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-rose-200">
                    {t('fileOperations.removeTagConfirm', { tag: pendingRemoveTag, count: selectedImages.length })}
                  </div>
                  <p className="mt-1 text-xs text-rose-200/70">
                    {t('fileOperations.removeTagHelp')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingRemoveTag(null);
                      focusInput();
                    }}
                    className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700"
                  >
                    {t('modelLibrary.cancel')}</button>
                  <button
                    type="button"
                    onClick={handleConfirmRemoveTag}
                    disabled={isSubmitting}
                    className="rounded-md border border-rose-500/40 bg-rose-600/80 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('promptLibrary.remove')}</button>
                </div>
              </div>
            </div>
          )}

          {/* Existing Tags List */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {t('fileOperations.currentTags')}</h3>
            
            {sortedExistingTags.length === 0 ? (
              <div className="text-center py-4 text-gray-500 text-sm italic">
                {t('fileOperations.noTags')}</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sortedExistingTags.map(({ name, count, isAll }) => (
                  <div
                    key={name}
                    className={`flex items-center rounded-full border text-sm transition-colors group ${
                      isAll 
                        ? 'bg-blue-900/30 border-blue-700/50 text-blue-200' 
                        : 'bg-gray-800 border-gray-700 text-gray-300 border-dashed'
                    }`}
                    title={isAll ? t('fileOperations.applyAll') : t('fileOperations.applySome', { count, total: selectedImages.length })}
                  >
                    <button
                      type="button"
                      onClick={() => void handleApplyExistingTag(name)}
                      disabled={isSubmitting}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-left transition-colors ${
                        isAll
                          ? 'hover:bg-blue-800/30 disabled:hover:bg-transparent'
                          : 'hover:bg-gray-700 disabled:hover:bg-transparent'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                      aria-label={t('fileOperations.applyNamed', { tag: name })}
                    >
                      <span className="max-w-[150px] truncate">{name}</span>
                      {!isAll && (
                         <span className="text-[10px] bg-gray-700 px-1 rounded-full text-gray-400">
                           {count}
                         </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleRemoveTagRequest(name, e)}
                      className="mr-1 text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={t('promptLibrary.removeTagNamed', { tag: name })}
                      title={t('promptLibrary.removeTagNamed', { tag: name })}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="mt-4 p-3 bg-gray-800/50 rounded-lg text-xs text-gray-400 border border-gray-700/50">
             <p>{t('fileOperations.tagsTip')}</p>
             {sortedExistingTags.some(t => !t.isAll) && (
               <p className="mt-1 text-yellow-500/80">
                 {t('fileOperations.dashedTags')}</p>
             )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 bg-gray-900 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors font-medium text-sm border border-gray-700"
          >
            {t('modelLibrary.done')}</button>
        </div>
      </div>
    </div>
  );
};

export default TagManagerModal;
