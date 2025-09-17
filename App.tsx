// Fix: Augment Window interface to include showDirectoryPicker for File System Access API.
declare global {
  interface Window {
    showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
  }
}

import React, { useState, useEffect, useCallback } from 'react';
import { type IndexedImage } from './types';
import { processDirectory, isIntermediateImage } from './services/fileIndexer';
import { cacheManager } from './services/cacheManager';
import FolderSelector from './components/FolderSelector';
import SearchBar from './components/SearchBar';
import ImageGrid from './components/ImageGrid';
import ImageModal from './components/ImageModal';
import Loader from './components/Loader';

export default function App() {
  const [images, setImages] = useState<IndexedImage[]>([]);
  const [filteredImages, setFilteredImages] = useState<IndexedImage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState<IndexedImage | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  
  // States for sorting and pagination
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | 'date-asc' | 'date-desc'>('asc');
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(20);
  const [currentPage, setCurrentPage] = useState(1);

  // Filter states
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedLora, setSelectedLora] = useState<string>('');

  // Load persisted settings on component mount
  useEffect(() => {
    const savedSortOrder = localStorage.getItem('invokeai-sort-order');
    const savedItemsPerPage = localStorage.getItem('invokeai-items-per-page');
    
    if (savedSortOrder) {
      setSortOrder(savedSortOrder as 'asc' | 'desc' | 'date-asc' | 'date-desc');
    }
    if (savedItemsPerPage) {
      const items = savedItemsPerPage === 'all' ? 'all' : Number(savedItemsPerPage);
      setItemsPerPage(items);
    }
  }, []);

  // Try to restore previous directory on app load
  useEffect(() => {
    const restoreDirectory = async () => {
      const savedDirectoryName = localStorage.getItem('invokeai-directory-name');
      if (savedDirectoryName && 'showDirectoryPicker' in window) {
        try {
          // Note: Due to browser security, we can't automatically restore the exact directory
          // We can only save the name for user reference
          // console.log removed for production
        } catch (error) {
          // console.log removed for production
        }
      }
    };
    restoreDirectory();
  }, []);

  // Function to extract unique models and LoRAs from all images
  const updateFilterOptions = useCallback((images: IndexedImage[]) => {
    const allModels = new Set<string>();
    const allLoras = new Set<string>();
    
    // // console.log removed for production
    
    images.forEach((image, index) => {
      console.log(`Image ${index}:`, {
        name: image.name,
        models: image.models,
        loras: image.loras,
        modelsType: typeof image.models,
        lorasType: typeof image.loras,
        modelsIsArray: Array.isArray(image.models),
        lorasIsArray: Array.isArray(image.loras),
        modelsKeys: image.models ? Object.keys(image.models) : [],
        lorasKeys: image.loras ? Object.keys(image.loras) : []
      });
      
      // Force conversion to array - handle both arrays and objects
      let imageModels = [];
      let imageLoras = [];
      
      // Handle models
      if (Array.isArray(image.models)) {
        imageModels = image.models;
        // console.log removed for production
      } else if (image.models && typeof image.models === 'object') {
        // Try different ways to extract from object
        const modelsObj = image.models as any;
        if (modelsObj.length !== undefined) {
          // Object with length property (array-like)
          imageModels = Array.from(modelsObj);
          // console.log removed for production
        } else {
          // Regular object - get values
          imageModels = Object.values(modelsObj).filter(v => v && typeof v === 'string');
          // console.log removed for production
        }
      }
      
      // Handle loras
      if (Array.isArray(image.loras)) {
        imageLoras = image.loras;
        // console.log removed for production
      } else if (image.loras && typeof image.loras === 'object') {
        // Try different ways to extract from object
        const lorasObj = image.loras as any;
        if (lorasObj.length !== undefined) {
          // Object with length property (array-like)
          imageLoras = Array.from(lorasObj);
          // console.log removed for production
        } else {
          // Regular object - get values
          imageLoras = Object.values(lorasObj).filter(v => v && typeof v === 'string');
          // console.log removed for production
        }
      }
      
      imageModels.forEach((model, idx) => {
        // console.log removed for production
        
        let modelName = '';
        if (typeof model === 'string') {
          modelName = model.trim();
        } else if (model && typeof model === 'object') {
          // Extract name from object - try different properties in order of preference
          modelName = model.name || model.model || model.model_name || 
                     model.base_model || model.mechanism || model.key;
          
          // If it's still an object, try to get a readable string
          if (typeof modelName !== 'string') {
            modelName = model.key || JSON.stringify(model);
          }
          
          // Clean up the name
          if (modelName && typeof modelName === 'string') {
            modelName = modelName.trim();
            // If it looks like a hash (long string of letters/numbers), try to find a better name
            if (modelName.length > 20 && /^[a-f0-9\-]+$/i.test(modelName)) {
              // Look for mechanism or type as fallback
              const fallbackName = model.mechanism || model.type || 'Unknown Model';
              modelName = `${fallbackName} (${modelName.substring(0, 8)}...)`;
            }
          }
        }
        
        if (modelName && modelName.length > 0) {
          allModels.add(modelName);
          // console.log removed for production
        } else {
          // console.log removed for production
        }
      });
      
      imageLoras.forEach((lora, idx) => {
        // console.log removed for production
        
        let loraName = '';
        if (typeof lora === 'string') {
          loraName = lora.trim();
        } else if (lora && typeof lora === 'object') {
          // Extract name from object - try different properties in order of preference
          loraName = lora.name || lora.model || lora.model_name || 
                    lora.base_model || lora.mechanism || lora.key;
          
          // If it's still an object, try to get a readable string
          if (typeof loraName !== 'string') {
            loraName = lora.key || JSON.stringify(lora);
          }
          
          // Clean up the name
          if (loraName && typeof loraName === 'string') {
            loraName = loraName.trim();
            // If it looks like a hash (long string of letters/numbers), try to find a better name
            if (loraName.length > 20 && /^[a-f0-9\-]+$/i.test(loraName)) {
              // Look for mechanism or type as fallback
              const fallbackName = lora.mechanism || lora.type || 'Unknown LoRA';
              loraName = `${fallbackName} (${loraName.substring(0, 8)}...)`;
            }
          }
        }
        
        if (loraName && loraName.length > 0) {
          allLoras.add(loraName);
          // console.log removed for production
        } else {
          // console.log removed for production
        }
      });
    });
    
    const finalModels = Array.from(allModels).sort();
    const finalLoras = Array.from(allLoras).sort();
    
    // console.log removed for production
    // console.log removed for production
    
    setAvailableModels(finalModels);
    setAvailableLoras(finalLoras);
  }, []);

  // Function to sort images
  const sortImages = useCallback((images: IndexedImage[]) => {
    return [...images].sort((a, b) => {
      if (sortOrder === 'asc') {
        return a.metadataString.localeCompare(b.metadataString);
      } else if (sortOrder === 'desc') {
        return b.metadataString.localeCompare(a.metadataString);
      } else if (sortOrder === 'date-asc') {
        return a.lastModified - b.lastModified;
      } else if (sortOrder === 'date-desc') {
        return b.lastModified - a.lastModified;
      }
      return 0;
    });
  }, [sortOrder]);

  // Save settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem('invokeai-sort-order', sortOrder);
  }, [sortOrder]);

  useEffect(() => {
    localStorage.setItem('invokeai-items-per-page', itemsPerPage.toString());
  }, [itemsPerPage]);

  // Helper function to get all file handles recursively
  const getAllFileHandles = async (
    directoryHandle: FileSystemDirectoryHandle,
    path: string = ''
  ): Promise<{handle: FileSystemFileHandle, path: string}[]> => {
    const entries = [];
    const dirHandle = directoryHandle as any;
    for await (const entry of dirHandle.values()) {
      const newPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.kind === 'file') {
        entries.push({handle: entry, path: newPath});
      } else if (entry.kind === 'directory') {
        entries.push(...(await getAllFileHandles(entry as FileSystemDirectoryHandle, newPath)));
      }
    }
    return entries;
  };

  // Helper function to reconstruct images from cached data
  const reconstructImagesFromCache = async (
    directoryHandle: FileSystemDirectoryHandle,
    cachedData: any
  ): Promise<IndexedImage[]> => {
    const allFiles = await getAllFileHandles(directoryHandle);
    const fileMap = new Map(allFiles.map(f => [f.handle.name, f.handle]));
    
    // Try to find thumbnails directory
    let thumbnailsDir: FileSystemDirectoryHandle | null = null;
    try {
      thumbnailsDir = await directoryHandle.getDirectoryHandle('thumbnails');
    } catch (error) {
      // Thumbnails directory doesn't exist
    }

    const thumbnailMap = new Map<string, FileSystemFileHandle>();
    if (thumbnailsDir) {
      const thumbnailFiles = await getAllFileHandles(thumbnailsDir);
      const webpFiles = thumbnailFiles.filter(f => f.handle.name.toLowerCase().endsWith('.webp'));
      
      for (const thumbFile of webpFiles) {
        const pngName = thumbFile.handle.name.replace(/\.webp$/i, '.png');
        thumbnailMap.set(pngName, thumbFile.handle);
      }
    }

    const reconstructedImages: IndexedImage[] = [];
    
    console.log('🔍 RECONSTRUCTING IMAGES FROM CACHE');
    console.log('Cached metadata:', cachedData.metadata);
    console.log('Files in directory:', Array.from(fileMap.keys()));
    console.log('Thumbnails in directory:', Array.from(thumbnailMap.keys()));

    for (const metadata of cachedData.metadata) {
      const fileHandle = fileMap.get(metadata.name);
      if (fileHandle) {
        const thumbnailHandle = thumbnailMap.get(metadata.name);
        
        reconstructedImages.push({
          id: metadata.id,
          name: metadata.name,
          handle: fileHandle,
          thumbnailHandle,
          metadata: JSON.parse(metadata.metadataString),
          metadataString: metadata.metadataString,
          lastModified: metadata.lastModified,
          models: metadata.models,
          loras: metadata.loras,
        });
      }
    }
    
    return reconstructedImages;
  };

  // Function to filter out InvokeAI intermediate images  
  const isIntermediateImage = (filename: string): boolean => {
    // TEMPORARILY DISABLED - let's see what we're dealing with
    return false;
    
    const name = filename.toLowerCase();
    
    // ONLY specific intermediate patterns - not normal InvokeAI images
    const intermediatePatterns = [
      // Classic intermediate patterns
      /^intermediate_/, 
      /_intermediate_/, 
      /^canvas_/, 
      /_canvas_/, 
      /^controlnet_/, 
      /_controlnet_/, 
      /^inpaint_/, 
      /_inpaint_/, 
      /^tmp_/, 
      /_tmp_/, 
      /^temp_/, 
      /_temp_/, 
      /\.tmp\.png$/, 
      /\.temp\.png$/,
      
      // Only very specific intermediate patterns
      /^step_\d+_/, // step_001_something.png (not just step_)
      /^preview_step/, // preview_step images
      /^progress_/, // progress images
      /^mask_temp/, // temporary masks only
      /^noise_sample/, // noise samples
      /^guidance_preview/, // guidance previews
    ];
    
    const isIntermediate = intermediatePatterns.some(pattern => pattern.test(name));
    
    if (isIntermediate) {
      console.log(`🗑️ FILTERING OUT: ${filename}`);
    }
    
    return isIntermediate;
  };

  const handleSelectFolder = async () => {
    try {
      if (!window.showDirectoryPicker) {
        setError("Your browser does not support the File System Access API. Please use a modern browser like Chrome or Edge.");
        return;
      }
      const handle = await window.showDirectoryPicker();
      setDirectoryHandle(handle);
      setIsLoading(true);
      setError(null);
      setImages([]);
      setFilteredImages([]);
      setSearchQuery('');
      setSelectedModel('');
      setSelectedLora('');
      setProgress({ current: 0, total: 0 });
      
      // Save directory name for user reference
      localStorage.setItem('invokeai-directory-name', handle.name);
      
      // Initialize cache manager
      await cacheManager.init();
      
      // Quick count of PNG files to determine if we should use cache
      const allFiles = await getAllFileHandles(handle);
      const pngCount = allFiles.filter(f => f.handle.name.toLowerCase().endsWith('.png')).length;
      
      // Check if we should use cached data
      const cacheResult = await cacheManager.shouldRefreshCache(handle.name, pngCount);
      
      if (!cacheResult.shouldRefresh) {
        console.log('✅ USING EXISTING CACHE');
        const cachedData = await cacheManager.getCachedData(handle.name);
        if (cachedData) {
          const reconstructedImages = await reconstructImagesFromCache(handle, cachedData);
          setImages(reconstructedImages);
          setFilteredImages(reconstructedImages);
          updateFilterOptions(reconstructedImages);
          setIsLoading(false);
          return;
        }
      } else {
        console.log('🔄 UPDATING CACHE INCREMENTALLY');
        const cachedData = await cacheManager.getCachedData(handle.name);
        
        if (cachedData) {
          // Use existing cache and add only new images
          const cachedFileNames = cachedData.metadata.map(meta => meta.name);
          const newFiles = allFiles.filter(f => 
            f.handle.name.toLowerCase().endsWith('.png') && 
            !cachedFileNames.includes(f.handle.name)
          );

          if (newFiles.length > 0) {
            console.log(`🆕 FOUND ${newFiles.length} NEW IMAGES`);
            const indexedNewImages = await processDirectory(handle, setProgress, newFiles);
            await cacheManager.updateCacheIncrementally(handle.name, indexedNewImages);
            
            // Reconstruct all images from updated cache
            const updatedCachedData = await cacheManager.getCachedData(handle.name);
            const allReconstructedImages = await reconstructImagesFromCache(handle, updatedCachedData);
            const sortedImages = sortImages(allReconstructedImages);
            setImages(sortedImages);
            setFilteredImages(sortedImages);
            updateFilterOptions(sortedImages);
          } else {
            console.log('📄 NO NEW IMAGES FOUND, USING EXISTING CACHE');
            const reconstructedImages = await reconstructImagesFromCache(handle, cachedData);
            setImages(reconstructedImages);
            setFilteredImages(reconstructedImages);
            updateFilterOptions(reconstructedImages);
          }
        } else {
          console.log('🔄 NO CACHE FOUND, FULL INDEXING');
          const indexedImages = await processDirectory(handle, setProgress);
          setImages(indexedImages);
          setFilteredImages(indexedImages);
          updateFilterOptions(indexedImages);
          await cacheManager.cacheData(handle.name, indexedImages);
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // console.log removed for production
      } else {
        console.error("Error selecting directory:", err);
        setError("Failed to process the directory. See console for details.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    console.log('🔍 FILTER EFFECT TRIGGERED:', { searchQuery, selectedModel, selectedLora, imagesCount: images.length });
    
    if (!searchQuery && !selectedModel && !selectedLora) {
      console.log('📄 NO FILTERS - SHOWING ALL IMAGES');
      const sortedImages = sortImages(images);
      setFilteredImages(sortedImages);
      return;
    }

    console.log('🎯 APPLYING FILTERS...');
    let results = images;

    // Apply search filter
    if (searchQuery) {
      const lowerCaseQuery = searchQuery.toLowerCase();
      // Use word boundary regex to match whole words only
      const searchRegex = new RegExp(`\\b${lowerCaseQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      results = results.filter(image => 
        searchRegex.test(image.metadataString)
      );
    }

    // Apply model filter
    if (selectedModel) {
      results = results.filter(image => 
        image.models.some(model => {
          // Ensure model is a string before calling toLowerCase
          const modelString = typeof model === 'string' ? model : String(model);
          return modelString.toLowerCase().includes(selectedModel.toLowerCase());
        })
      );
    }

    // Apply LoRA filter
    if (selectedLora) {
      console.log('🔍 APPLYING LORA FILTER:', selectedLora);
      console.log('🔍 TOTAL IMAGES BEFORE LORA FILTER:', results.length);
      
      results = results.filter(image => {
        console.log('🔍 Filtering by LoRA:', { selectedLora, imageLoras: image.loras });
        return image.loras.some(lora => {
          // Ensure lora is a string before calling toLowerCase
          const loraString = typeof lora === 'string' ? lora : String(lora);
          const match = loraString.toLowerCase().includes(selectedLora.toLowerCase());
          console.log('🔍 LoRA match check:', { lora: loraString, selectedLora, match });
          return match;
        });
      });
      
      console.log('🔍 TOTAL IMAGES AFTER LORA FILTER:', results.length);
    }

    const sortedResults = sortImages(results);
    setFilteredImages(sortedResults);
    setCurrentPage(1); // Reset to first page when searching/filtering
  }, [searchQuery, images, selectedModel, selectedLora, sortImages]);

  // Calculate paginated images
  const paginatedImages = itemsPerPage === 'all' 
    ? filteredImages 
    : filteredImages.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
      );

  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredImages.length / itemsPerPage);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans">
      <header className="bg-gray-800/80 backdrop-blur-sm sticky top-0 z-10 p-4 shadow-lg">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.83 2.17C11.42 1.41 10.58 1.41 10.17 2.17L2.17 16.17C1.76 16.93 2.23 18 3 18H21C21.77 18 22.24 16.93 21.83 16.17L13.83 2.17C13.42 1.41 12.58 1.41 12.17 2.17L11.83 2.17Z" fillOpacity="0.01"/>
              <path d="M12 2L3 18H21L12 2ZM12 5.5L18.6 16H5.4L12 5.5Z"/>
            </svg>
            <h1 className="text-2xl font-bold tracking-wider">Local Image Browser</h1>
          </div>
          {directoryHandle && <SearchBar value={searchQuery} onChange={setSearchQuery} />}
          
          {/* Model and LoRA Filters */}
          {directoryHandle && (availableModels.length > 0 || availableLoras.length > 0) && (
            <div className="mb-6 p-4 bg-gray-800/30 rounded-lg border border-gray-700">
              <h3 className="text-gray-300 text-sm font-medium mb-3">Filters</h3>
              <div className="flex flex-col sm:flex-row gap-4">
                {/* Model Filter */}
                {availableModels.length > 0 && (
                  <div className="flex-1">
                    <label htmlFor="modelFilter" className="text-gray-400 text-sm mb-2 block">Filter by Model:</label>
                    <select
                      id="modelFilter"
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full bg-gray-700 text-gray-200 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
                      aria-describedby="model-filter-description"
                    >
                      <option value="">All Models ({availableModels.length})</option>
                      {availableModels.map((model, index) => (
                        <option key={`model-${index}-${model}`} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <span id="model-filter-description" className="sr-only">Filter images by the AI model used to generate them</span>
                  </div>
                )}

                {/* LoRA Filter */}
                {availableLoras.length > 0 && (
                  <div className="flex-1">
                    <label htmlFor="loraFilter" className="text-gray-400 text-sm mb-2 block">Filter by LoRA:</label>
                    <select
                      id="loraFilter"
                      value={selectedLora}
                      onChange={(e) => setSelectedLora(e.target.value)}
                      className="w-full bg-gray-700 text-gray-200 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
                      aria-describedby="lora-filter-description"
                    >
                      <option value="">All LoRAs ({availableLoras.length})</option>
                      {availableLoras.map((lora, index) => (
                        <option key={`lora-${index}-${lora}`} value={lora}>
                          {lora}
                        </option>
                      ))}
                    </select>
                    <span id="lora-filter-description" className="sr-only">Filter images by the LoRA (Low-Rank Adaptation) models used</span>
                  </div>
                )}

                {/* Clear Filters Button */}
                {(selectedModel || selectedLora) && (
                  <div className="flex items-end">
                    <button
                      onClick={() => {
                        setSelectedModel('');
                        setSelectedLora('');
                      }}
                      className="bg-gray-600 hover:bg-gray-500 text-gray-200 px-4 py-2 rounded-lg text-sm transition-colors duration-200 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                      aria-label="Clear all filters"
                    >
                      Clear Filters
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          <button
            onClick={handleSelectFolder}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200 shadow-md whitespace-nowrap focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            aria-label={directoryHandle ? 'Change InvokeAI folder location' : 'Select InvokeAI folder to browse images'}
          >
            {directoryHandle ? 'Change Folder' : 'Select InvokeAI Folder'}
          </button>
        </div>
      </header>

      <main className="container mx-auto p-4 sm:p-6">
        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg relative my-4" role="alert">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        )}

        {isLoading && <Loader progress={progress} />}

        {!isLoading && !directoryHandle && <FolderSelector onSelectFolder={handleSelectFolder} />}

        {directoryHandle && !isLoading && (
          <>
            <div className="mb-6 p-4 bg-gradient-to-r from-gray-800/50 to-gray-700/50 rounded-lg border border-gray-600" role="status" aria-live="polite">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="text-gray-300">
                  Found <span className="text-blue-400 font-bold text-lg">{filteredImages.length}</span> of <span className="text-green-400 font-bold text-lg">{images.length}</span> images
                  {(selectedModel || selectedLora || searchQuery) && (
                    <span className="text-yellow-400 text-sm ml-2">
                      (filtered{searchQuery && ' by search'}{selectedModel && ' by model'}{selectedLora && ' by LoRA'})
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-400">
                  Searching in <span className="font-mono text-blue-300 bg-gray-800 px-2 py-1 rounded border border-gray-600">{directoryHandle.name}</span>
                  <br />
                  <span className="text-xs">Models: {availableModels.length}, LoRAs: {availableLoras.length}</span>
                </div>
              </div>
              {(selectedModel || selectedLora) && (
                <div className="mt-2 text-xs text-gray-400">
                  Active filters: 
                  {selectedModel && <span className="ml-1 bg-blue-600 text-blue-100 px-2 py-1 rounded">Model: {selectedModel}</span>}
                  {selectedLora && <span className="ml-1 bg-purple-600 text-purple-100 px-2 py-1 rounded">LoRA: {selectedLora}</span>}
                </div>
              )}
            </div>
            
            {/* Sort and Pagination Controls */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className="flex items-center gap-4">
                <label htmlFor="sortOrder" className="text-gray-300 text-sm font-medium">Sort By:</label>
                <select
                  id="sortOrder"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc' | 'date-asc' | 'date-desc')}
                  className="bg-gray-700 text-gray-200 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
                  aria-describedby="sort-description"
                >
                  <option value="asc">A-Z (Ascending)</option>
                  <option value="desc">Z-A (Descending)</option>
                  <option value="date-asc">Date (Oldest First)</option>
                  <option value="date-desc">Date (Newest First)</option>
                </select>
                <span id="sort-description" className="sr-only">Choose how to sort the images</span>
              </div>

              <div className="flex items-center gap-4">
                <label htmlFor="itemsPerPage" className="text-gray-300 text-sm font-medium">Items Per Page:</label>
                <select
                  id="itemsPerPage"
                  value={itemsPerPage}
                  onChange={(e) => {
                    const value = e.target.value === 'all' ? 'all' : Number(e.target.value);
                    setItemsPerPage(value);
                    setCurrentPage(1); // Reset to first page
                  }}
                  className="bg-gray-700 text-gray-200 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-200"
                  aria-describedby="pagination-description"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value="all">All</option>
                </select>
                <span id="pagination-description" className="sr-only">Choose how many images to display per page</span>
              </div>
            </div>
            
            <ImageGrid images={paginatedImages} onImageClick={setSelectedImage} />
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mt-8 p-4 bg-gray-800/30 rounded-lg border border-gray-700">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-500 text-gray-100 px-5 py-2 rounded-lg transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 shadow-md disabled:shadow-none"
                    aria-label="Go to previous page"
                  >
                    ← Previous
                  </button>
                  
                  <div className="flex items-center gap-2 px-4 py-2 bg-gray-700/50 rounded-lg border border-gray-600">
                    <span className="text-gray-300 text-sm font-medium" aria-live="polite" aria-atomic="true">
                      Page <span className="text-blue-400 font-bold">{currentPage}</span> of <span className="text-green-400 font-bold">{totalPages}</span>
                    </span>
                  </div>
                  
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-500 text-gray-100 px-5 py-2 rounded-lg transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 shadow-md disabled:shadow-none"
                    aria-label="Go to next page"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {selectedImage && <ImageModal image={selectedImage} onClose={() => setSelectedImage(null)} />}
    </div>
  );
}
