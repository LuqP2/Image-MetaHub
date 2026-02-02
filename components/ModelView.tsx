import React, { useMemo, useState } from 'react';
import { Box } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { IndexedImage } from '../types';
import ModelCard from './ModelCard';
import Footer from './Footer';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';
import { useGenerationQueueStore } from '../store/useGenerationQueueStore';

interface ModelEntry {
  name: string;
  images: IndexedImage[];
  count: number;
}

interface ModelViewProps {
  isQueueOpen?: boolean;
  onToggleQueue?: () => void;
  onModelSelect: (modelName: string) => void;
}


export const ModelView: React.FC<ModelViewProps> = ({ isQueueOpen = false, onToggleQueue, onModelSelect }) => {
  const images = useImageStore((state) => state.images); // Use all images, not filtered ones
  const filteredImages = useImageStore((state) => state.filteredImages); // For footer stats
  const selectionTotalImages = useImageStore((state) => state.selectionTotalImages);
  const selectionDirectoryCount = useImageStore((state) => state.selectionDirectoryCount);
  const enrichmentProgress = useImageStore((state) => state.enrichmentProgress);
  
  const { itemsPerPage, setItemsPerPage, viewMode, toggleViewMode } = useSettingsStore();
  const { progressState: a1111Progress } = useA1111ProgressContext();
  const queueCount = useGenerationQueueStore((state) =>
    state.items.filter((item) => item.status === 'waiting' || item.status === 'processing').length
  );

  const [page, setPage] = useState(1);
  const [sortBy] = useState<'count' | 'name'>('count');

  // Extract models and group images
  const modelEntries = useMemo(() => {
    const models = new Map<string, IndexedImage[]>();

    images.forEach(image => {
      if (image.models && image.models.length > 0) {
        image.models.forEach(modelName => {
          if (!modelName) return;
          
          if (!models.has(modelName)) {
            models.set(modelName, []);
          }
          models.get(modelName)?.push(image);
        });
      } else {
        // Handle images with no model metadata if needed, or skip
        // For now, skipping un-modeled images in this view
      }
    });

    const entries: ModelEntry[] = Array.from(models.entries()).map(([name, modelImages]) => ({
      name,
      images: modelImages.sort((a, b) => b.lastModified - a.lastModified), // Sort images by newest first
      count: modelImages.length
    }));

    // Sort models
    return entries.sort((a, b) => {
      if (sortBy === 'count') {
        const countDiff = b.count - a.count;
        if (countDiff !== 0) return countDiff;
      }
      return a.name.localeCompare(b.name);
    });
  }, [images, sortBy]);

  const totalPages = Math.ceil(modelEntries.length / itemsPerPage);
  
  const paginatedEntries = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return modelEntries.slice(start, start + itemsPerPage);
  }, [modelEntries, page, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  return (
    <section className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-auto pr-1">
        {modelEntries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-400">
            <div className="w-14 h-14 rounded-full bg-gray-800/60 flex items-center justify-center mb-3">
              <Box className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-gray-200">No models found</h3>
            <p className="text-xs max-w-md mt-2">
              Index images containing metadata to see models here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {paginatedEntries.map((entry) => (
              <ModelCard
                key={entry.name}
                modelName={entry.name}
                images={entry.images}
                imageCount={entry.count}
                onClick={() => onModelSelect(entry.name)}
              />
            ))}
          </div>
        )}
      </div>

      <Footer
        currentPage={page}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        itemsPerPage={itemsPerPage}
        onItemsPerPageChange={setItemsPerPage}
        viewMode={viewMode}
        onViewModeChange={toggleViewMode}
        filteredCount={filteredImages.length} 
        totalCount={selectionTotalImages}
        directoryCount={selectionDirectoryCount}
        enrichmentProgress={enrichmentProgress}
        a1111Progress={a1111Progress}
        queueCount={queueCount}
        isQueueOpen={isQueueOpen}
        onToggleQueue={onToggleQueue}
        customText={`Showing ${modelEntries.length} models`}
      />
    </section>
  );
};


