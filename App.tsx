import React, { useState, useEffect, useCallback, useRef } from 'react';
import { type IndexedImage } from './types';
import { processDirectory, isIntermediateImage } from './services/fileIndexer';
import { cacheManager } from './services/cacheManager';
import { FileOperations } from './services/fileOperations';
import FolderSelector from './components/FolderSelector';
import SearchBar from './components/SearchBar';
import ImageGrid from './components/ImageGrid';
import ImageModal from './components/ImageModal';
import Loader from './components/Loader';
import Sidebar from './components/Sidebar';
import { SearchField } from './components/SearchBar';

export default function App() {
  // console.log('🚀 App component initialized');
  // console.log('📊 localStorage no início do App:', Object.keys(localStorage));
  // console.log('🔍 Directory path no início:', localStorage.getItem('invokeai-electron-directory-path'));
  
  const [images, setImages] = useState<IndexedImage[]>([]);
  const [filteredImages, setFilteredImages] = useState<IndexedImage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('any');
  const [selectedImage, setSelectedImage] = useState<IndexedImage | null>(null);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());

  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [directoryPath, setDirectoryPath] = useState('');
  
  // States for sorting and pagination
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | 'date-asc' | 'date-desc'>('date-desc');
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(20);
  const [currentPage, setCurrentPage] = useState(1);

  // Filter states
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);
  const [availableSchedulers, setAvailableSchedulers] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedLoras, setSelectedLoras] = useState<string[]>([]);
  const [selectedSchedulers, setSelectedSchedulers] = useState<string[]>([]);
  const [advancedFilters, setAdvancedFilters] = useState<any>({});


  // Load persisted settings on component mount
  useEffect(() => {
    // console.log('🔄 useEffect executado - carregando configurações persistidas');
    // console.log('📊 localStorage completo no início:', Object.keys(localStorage));
    
    const savedSortOrder = localStorage.getItem('invokeai-sort-order');
    const savedItemsPerPage = localStorage.getItem('invokeai-items-per-page');
    const savedDirectoryPath = localStorage.getItem('invokeai-electron-directory-path');
    
    // console.log('🔍 localStorage key:', 'invokeai-electron-directory-path');
    // console.log('🔍 storedPath from localStorage:', savedDirectoryPath);
    
    if (savedSortOrder) {
      setSortOrder(savedSortOrder as 'asc' | 'desc' | 'date-asc' | 'date-desc');
    } else {
      // Set default to date descending (newest first) and save it
      setSortOrder('date-desc');
      localStorage.setItem('invokeai-sort-order', 'date-desc');
    }
    if (savedItemsPerPage) {
      const items = savedItemsPerPage === 'all' ? 'all' : Number(savedItemsPerPage);
      setItemsPerPage(items);
    }
    if (savedDirectoryPath) {
      setDirectoryPath(savedDirectoryPath);
      // console.log('✅ directoryPath set to:', savedDirectoryPath);
    } else {
      // console.log('❌ No path found in localStorage');
    }
    
    // Verificar novamente após um pequeno delay para ver se há problema de timing
    setTimeout(() => {
      const delayedCheck = localStorage.getItem('invokeai-electron-directory-path');
      // console.log('⏰ Delayed check (100ms) - storedPath:', delayedCheck);
    }, 100);
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
    const allSchedulers = new Set<string>();
    const allBoards = new Set<string>();
    
    // // console.log removed for production
    
    images.forEach((image, index) => {
      // console.log(`Image ${index}:`, {
      //   name: image.name,
      //   models: image.models,
      //   loras: image.loras,
      //   scheduler: image.scheduler,
      //   board: image.board,
      //   modelsType: typeof image.models,
      //   lorasType: typeof image.loras,
      //   schedulerType: typeof image.scheduler,
      //   modelsIsArray: Array.isArray(image.models),
      //   lorasIsArray: Array.isArray(image.loras),
      //   modelsKeys: image.models ? Object.keys(image.models) : [],
      //   lorasKeys: image.loras ? Object.keys(image.loras) : []
      // });
      
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
      
      // Handle scheduler
      if (image.scheduler && typeof image.scheduler === 'string') {
        const schedulerName = image.scheduler.trim();
        if (schedulerName.length > 0) {
          allSchedulers.add(schedulerName);
        }
      }
      
      // Handle board
      if (image.board && typeof image.board === 'string') {
        const boardName = image.board.trim();
        if (boardName.length > 0) {
          allBoards.add(boardName);
        }
      }
    });
    
    const finalModels = Array.from(allModels).sort();
    const finalLoras = Array.from(allLoras).sort();
    const finalSchedulers = Array.from(allSchedulers).sort();
  const finalBoards = Array.from(allBoards).sort();
    
  // console.log removed for production
  // console.log removed for production
    
  setAvailableModels(finalModels);
  setAvailableLoras(finalLoras);
  setAvailableSchedulers(finalSchedulers);
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

  // Cache for file handles to avoid repeated calls
  const fileHandlesCache = useRef<Map<string, {handle: FileSystemFileHandle, path: string}[]>>(new Map());

  // Helper function to get all file handles recursively
  const getAllFileHandles = async (
    directoryHandle: FileSystemDirectoryHandle,
    path: string = ''
  ): Promise<{handle: FileSystemFileHandle, path: string}[]> => {
    const cacheKey = directoryHandle.name + (path ? `_${path}` : '');
    
    // Check cache first
    if (fileHandlesCache.current.has(cacheKey)) {
      // console.log('📋 Using cached file handles for:', cacheKey);
      return fileHandlesCache.current.get(cacheKey)!;
    }

    const entries = [];
    const dirHandle = directoryHandle as any;

    // Check if we're running in Electron
    const isElectron = typeof window.electronAPI !== 'undefined';
    // console.log('🔧 getAllFileHandles called, isElectron (FIXED):', isElectron);

    if (isElectron) {
      // console.log('⚡ Using Electron file system APIs (FIXED)');
      // Use Electron/Node.js file system APIs
      try {
        const electronPath = localStorage.getItem('invokeai-electron-directory-path');
        if (!electronPath) {
          console.error('❌ No Electron directory path stored');
          return entries;
        }

        // Use Electron API to list files
        // console.log('📂 Listing files in Electron directory:', electronPath);
        const result = await window.electronAPI.listDirectoryFiles(electronPath);
        // console.log('📋 Electron API result:', result);
        if (result.success && result.files) {
          // console.log('✅ Found', result.files.length, 'PNG files in Electron');
          for (const fileName of result.files) {
            // Create a mock file handle for Electron
            const mockHandle = {
              name: fileName,
              kind: 'file' as const,
              getFile: async () => {
                try {
                  // Use Electron API to read the actual file
                  const fullPath = electronPath + '\\' + fileName; // Simple path joining for Windows
                  const fileResult = await window.electronAPI.readFile(fullPath);
                  if (fileResult.success) {
                    // Create a proper File object from the buffer
                    const uint8Array = new Uint8Array(fileResult.data);
                    return new File([uint8Array], fileName, { type: 'image/png' });
                  } else {
                    console.error('❌ Failed to read file:', fileName, fileResult.error);
                    // Return empty file as fallback
                    return new File([], fileName, { type: 'image/png' });
                  }
                } catch (error) {
                  console.error('❌ Error reading file in Electron:', fileName, error);
                  return new File([], fileName, { type: 'image/png' });
                }
              }
            };
            entries.push({ handle: mockHandle, path: fileName });
          }
        } else {
          console.error('❌ Electron API failed:', result.error);
        }
        
        // Cache the result
        fileHandlesCache.current.set(cacheKey, entries);
        return entries;
      } catch (error) {
        console.error('❌ Error listing files in Electron:', error);
        return entries;
      }
    } else {
      // Use browser File System Access API
      // console.log('🌐 Using browser File System Access API (fallback)');
      for await (const entry of dirHandle.values()) {
        const newPath = path ? `${path}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
          entries.push({handle: entry, path: newPath});
        } else if (entry.kind === 'directory') {
          entries.push(...(await getAllFileHandles(entry as FileSystemDirectoryHandle, newPath)));
        }
      }
      
      // Cache the result
      fileHandlesCache.current.set(cacheKey, entries);
      return entries;
    }
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
          scheduler: metadata.scheduler,
          board: metadata.board || 'Uncategorized',
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
      setError(null);
      setSuccess(null);
      let handle: any;

      // Check if we're running in Electron
      const isElectron = typeof window.electronAPI !== 'undefined';
      // console.log('🔍 isElectron detection (FIXED):', isElectron);

      if (isElectron) {
        // Use Electron's directory picker
        // console.log('🔍 Opening Electron directory dialog...');
        const result = await window.electronAPI.showDirectoryDialog();
        // console.log('📁 Directory dialog result:', result);

        if (result.canceled || !result.success) {
          // console.log('❌ Directory selection cancelled or failed:', result.error);
          setError(result.error || 'Directory selection was cancelled');
          setSuccess(null);
          return;
        }

        if (!result.path) {
          console.error('❌ No path returned from directory dialog');
          console.log('🔍 Full result object:', result);
          setError('No directory path received from dialog');
          setSuccess(null);
          return;
        }

        console.log('✅ Directory selected, result.path:', result.path);

        console.log('✅ Directory selected:', result.path);

        // Create a mock handle for Electron environment
        handle = {
          name: result.name || 'Selected Folder',
          path: result.path,
          kind: 'directory',
          // Add methods that getAllFileHandles expects
          values: async function* () {
            // This will be implemented differently for Electron
            yield* [];
          }
        };

        // Store the actual path for Electron - ensure it's stored before proceeding
        console.log('🔍 ANTES do localStorage.setItem, result.path:', result.path);
        localStorage.setItem('invokeai-electron-directory-path', result.path);
        console.log('🔍 APÓS localStorage.setItem');
        console.log('🔍 Verificação imediata:', localStorage.getItem('invokeai-electron-directory-path'));
        console.log('� IMMEDIATE CHECK após setItem:', localStorage.getItem('invokeai-electron-directory-path'));
        console.log('�💾 Stored directory path in localStorage:', result.path);
        console.log('🔍 APÓS localStorage.setItem');
        console.log('🔍 Verificação imediata:', localStorage.getItem('invokeai-electron-directory-path'));

        // Also store in sessionStorage as backup
        sessionStorage.setItem('invokeai-electron-directory-path', result.path);
        console.log('💾 Also stored directory path in sessionStorage:', result.path);
      } else {
        // Use browser's File System Access API
        if (!window.showDirectoryPicker) {
          setError("Your browser does not support the File System Access API. Please use a modern browser like Chrome or Edge.");
          setSuccess(null);
          return;
        }
        handle = await window.showDirectoryPicker();
      }

      setDirectoryHandle(handle);
      setIsLoading(true);
      setError(null);
      setImages([]);
      setFilteredImages([]);
      setSearchQuery('');
      setSelectedModels([]);
      setSelectedLoras([]);
      setSelectedSchedulers([]);
      setProgress({ current: 0, total: 0 });

      // Clear file handles cache when selecting new directory
      fileHandlesCache.current.clear();

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
            const indexedNewImages = await processDirectory(handle, setProgress, newFiles, handle.name);
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
          const indexedImages = await processDirectory(handle, setProgress, undefined, handle.name);
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
        setSuccess(null);
      }
    } finally {
      console.log('🏁 handleSelectFolder FINAL - localStorage check:', localStorage.getItem('invokeai-electron-directory-path'));
      setIsLoading(false);
    }
  };

  const handleUpdateFolder = async () => {
    if (!directoryHandle) {
      setError('No directory selected to refresh');
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      setIsLoading(true);
      setImages([]);
      setFilteredImages([]);
      setSearchQuery('');
      setSelectedModels([]);
      setSelectedLoras([]);
      setSelectedSchedulers([]);
      setProgress({ current: 0, total: 0 });

      // Clear file handles cache
      fileHandlesCache.current.clear();

      // Force full re-indexing by clearing cache
      await cacheManager.clearCache();
      
      // Full indexing
      const indexedImages = await processDirectory(directoryHandle, setProgress, undefined, directoryHandle.name);
      setImages(indexedImages);
      setFilteredImages(indexedImages);
      updateFilterOptions(indexedImages);
      await cacheManager.cacheData(directoryHandle.name, indexedImages);
      
      setSuccess('Folder refreshed successfully!');
    } catch (err) {
      console.error("Error refreshing directory:", err);
      setError("Failed to refresh the directory. See console for details.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangeFolder = async () => {
    // Reset everything and call handleSelectFolder
    setDirectoryHandle(null);
    setDirectoryPath('');
    setImages([]);
    setFilteredImages([]);
    setSearchQuery('');
    setSelectedModels([]);
    setSelectedLoras([]);
    setSelectedSchedulers([]);
    setError(null);
    setSuccess(null);
    
    // Clear localStorage
    localStorage.removeItem('invokeai-electron-directory-path');
    localStorage.removeItem('invokeai-directory-name');
    sessionStorage.removeItem('invokeai-electron-directory-path');
    
    // Call handleSelectFolder to choose new directory
    await handleSelectFolder();
  };

  const handleUpdateIndexing = async () => {
    if (!directoryHandle && !directoryPath) {
      setError('No directory selected. Please select a directory first.');
      setSuccess(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      // Initialize cache manager
      await cacheManager.init();

      // Get all current files
      const allFiles = await getAllFileHandles(directoryHandle);
      const pngCount = allFiles.filter(f => f.handle.name.toLowerCase().endsWith('.png')).length;

      // Check if we should use cached data
      const cacheResult = await cacheManager.shouldRefreshCache(directoryHandle.name, pngCount);

      if (!cacheResult.shouldRefresh) {
        console.log('✅ CACHE IS UP TO DATE');
        setError('All images are already indexed. No new images found.');
        setSuccess(null);
        setIsLoading(false);
        return;
      }

      // Get existing cache
      const cachedData = await cacheManager.getCachedData(directoryHandle.name);

      if (!cachedData) {
        setError('No existing cache found. Please use "Change Folder" to perform a full index.');
        setSuccess(null);
        setIsLoading(false);
        return;
      }

      // Find new files that aren't in cache
      const cachedFileNames = cachedData.metadata.map(meta => meta.name);
      const newFiles = allFiles.filter(f =>
        f.handle.name.toLowerCase().endsWith('.png') &&
        !isIntermediateImage(f.handle.name) &&
        !cachedFileNames.includes(f.handle.name)
      );

      if (newFiles.length === 0) {
        console.log('📄 NO NEW IMAGES FOUND');
        
        // Check if any images were deleted
        const cachedFileCount = cachedData.metadata.length;
        const currentFileCount = allFiles.filter(f => f.handle.name.toLowerCase().endsWith('.png') && !isIntermediateImage(f.handle.name)).length;
        const deletedCount = cachedFileCount - currentFileCount;
        
        if (deletedCount > 0) {
          const successMessage = `Removed ${deletedCount} deleted image${deletedCount === 1 ? '' : 's'} from index.`;
          console.log(`✅ ${successMessage.toUpperCase()}`);
          setSuccess(successMessage);
        } else {
          setError('No new images found. All images are already indexed.');
        }
        
        setIsLoading(false);
        return;
      }

      console.log(`🆕 FOUND ${newFiles.length} NEW IMAGES TO INDEX`);

      // Process only new images
      const indexedNewImages = await processDirectory(directoryHandle, setProgress, newFiles, directoryHandle.name);

      // Update cache incrementally
      await cacheManager.updateCacheIncrementally(directoryHandle.name, indexedNewImages);

      // Get updated cache and reconstruct all images
      const updatedCachedData = await cacheManager.getCachedData(directoryHandle.name);
      if (updatedCachedData) {
        const allReconstructedImages = await reconstructImagesFromCache(directoryHandle, updatedCachedData);
        const sortedImages = sortImages(allReconstructedImages);

        // Update state while preserving current filters and pagination
        setImages(sortedImages);
        updateFilterOptions(sortedImages);

        // Re-apply current filters to the updated image list
        let currentFilteredImages = sortedImages;
        
        // Apply current search filter if exists
        if (searchQuery) {
          const lowerCaseQuery = searchQuery.toLowerCase();
          currentFilteredImages = currentFilteredImages.filter(image => {
            switch (searchField) {
              case 'any':
                const anyRegex = new RegExp(`\\b${lowerCaseQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                return anyRegex.test(image.metadataString);
              case 'prompt':
                const promptText = image.metadata?.prompt;
                if (typeof promptText === 'string') {
                  return promptText.toLowerCase().includes(lowerCaseQuery);
                } else if (Array.isArray(promptText)) {
                  return promptText.some((p: any) => typeof p === 'string' && p.toLowerCase().includes(lowerCaseQuery));
                }
                return false;
              case 'model':
                return image.models.some(model => {
                  const modelString = typeof model === 'string' ? model : String(model);
                  return modelString.toLowerCase().includes(lowerCaseQuery);
                });
              case 'lora':
                return image.loras.some(lora => {
                  const loraString = typeof lora === 'string' ? lora : String(lora);
                  return loraString.toLowerCase().includes(lowerCaseQuery);
                });
              case 'seed':
                const seedString = String(image.metadata?.seed || '');
                return seedString.includes(lowerCaseQuery);
              case 'settings':
                const cfgString = String(image.metadata?.cfg_scale || image.metadata?.guidance_scale || '');
                const stepsString = String(image.metadata?.steps || image.metadata?.num_inference_steps || '');
                const schedulerString = String(image.scheduler || '');
                return cfgString.includes(lowerCaseQuery) || stepsString.includes(lowerCaseQuery) || schedulerString.toLowerCase().includes(lowerCaseQuery);
              default:
                return true;
            }
          });
        }

        // Apply model filters
        if (selectedModels.length > 0) {
          currentFilteredImages = currentFilteredImages.filter(image =>
            selectedModels.some(selectedModel =>
              image.models.some(model =>
                typeof model === 'string' && model.toLowerCase().includes(selectedModel.toLowerCase())
              )
            )
          );
        }

        // Apply LoRA filters
        if (selectedLoras.length > 0) {
          currentFilteredImages = currentFilteredImages.filter(image =>
            selectedLoras.some(selectedLora =>
              image.loras.some(lora =>
                typeof lora === 'string' && lora.toLowerCase().includes(selectedLora.toLowerCase())
              )
            )
          );
        }

        // Apply scheduler filters
        if (selectedSchedulers.length > 0) {
          currentFilteredImages = currentFilteredImages.filter(image =>
            selectedSchedulers.some(selectedScheduler =>
              image.scheduler.toLowerCase().includes(selectedScheduler.toLowerCase())
            )
          );
        }

        // Apply advanced filters
        if (advancedFilters.dimension) {
          currentFilteredImages = currentFilteredImages.filter(image => {
            const key = `${image.metadata.width}×${image.metadata.height}`;
            return key === advancedFilters.dimension;
          });
        }

        if (advancedFilters.steps) {
          const { min, max } = advancedFilters.steps;
          currentFilteredImages = currentFilteredImages.filter(image => {
            const steps = image.metadata?.steps || image.metadata?.num_inference_steps;
            return steps >= min && steps <= max;
          });
        }

        if (advancedFilters.cfg) {
          const { min, max } = advancedFilters.cfg;
          currentFilteredImages = currentFilteredImages.filter(image => {
            const cfg = image.metadata?.cfg_scale || image.metadata?.guidance_scale;
            return cfg >= min && cfg <= max;
          });
        }

        if (advancedFilters.date) {
          const { from, to } = advancedFilters.date;
          currentFilteredImages = currentFilteredImages.filter(image => {
            const imageDate = new Date(image.lastModified).toISOString().split('T')[0];
            return imageDate >= from && imageDate <= to;
          });
        }

        setFilteredImages(sortImages(currentFilteredImages));

        // Calculate summary of changes
        const cachedFileCount = cachedData.metadata.length;
        const currentFileCount = allFiles.filter(f => f.handle.name.toLowerCase().endsWith('.png') && !isIntermediateImage(f.handle.name)).length;
        const deletedCount = cachedFileCount - (currentFileCount - newFiles.length);

        // Create descriptive success message
        let successMessage = '';
        if (newFiles.length > 0 && deletedCount > 0) {
          successMessage = `Indexed ${newFiles.length} new images. Removed ${deletedCount} deleted images.`;
        } else if (newFiles.length > 0) {
          successMessage = `Indexed ${newFiles.length} new image${newFiles.length === 1 ? '' : 's'}.`;
        } else if (deletedCount > 0) {
          successMessage = `Removed ${deletedCount} deleted image${deletedCount === 1 ? '' : 's'} from index.`;
        } else {
          successMessage = 'Index is up to date. No changes detected.';
        }

        console.log(`✅ ${successMessage.toUpperCase()}`);
        setSuccess(successMessage);
      }

    } catch (err) {
      console.error("Error updating index:", err);
      setError("Failed to update index. See console for details.");
      setSuccess(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    console.log('🔍 FILTER EFFECT TRIGGERED:', { searchQuery, selectedModels, selectedLoras, selectedSchedulers, advancedFilters, imagesCount: images.length });
    
    if (!searchQuery && selectedModels.length === 0 && selectedLoras.length === 0 && selectedSchedulers.length === 0 && Object.keys(advancedFilters).length === 0) {
      console.log('📄 NO FILTERS - SHOWING ALL IMAGES');
      const sortedImages = sortImages(images);
      setFilteredImages(sortedImages);
      return;
    }

    console.log('🎯 APPLYING FILTERS...');
    let results = images;

    // Apply search filter based on selected field
    if (searchQuery) {
      const lowerCaseQuery = searchQuery.toLowerCase();

      results = results.filter(image => {
        switch (searchField) {
          case 'any':
            // Search in all fields (original behavior) - use word boundary for precision
            const anyRegex = new RegExp(`\\b${lowerCaseQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return anyRegex.test(image.metadataString);

          case 'prompt':
            // Search only in prompt field - use substring matching for flexibility
            const promptText = image.metadata?.prompt;
            if (typeof promptText === 'string') {
              return promptText.toLowerCase().includes(lowerCaseQuery);
            } else if (Array.isArray(promptText)) {
              return promptText.some((p: any) => typeof p === 'string' && p.toLowerCase().includes(lowerCaseQuery));
            }
            return false;

          case 'model':
            // Search only in models array - use substring search for flexibility
            return image.models.some(model => {
              const modelString = typeof model === 'string' ? model : String(model);
              return modelString.toLowerCase().includes(lowerCaseQuery);
            });

          case 'lora':
            // Search only in loras array - use substring search for flexibility
            return image.loras.some(lora => {
              const loraString = typeof lora === 'string' ? lora : String(lora);
              return loraString.toLowerCase().includes(lowerCaseQuery);
            });

          case 'seed':
            // Search only in seed field - exact match for precision
            const seedString = String(image.metadata?.seed || '');
            return seedString.includes(lowerCaseQuery);

          case 'settings':
            // Search in CFG, steps, and scheduler - use substring for flexibility
            const cfgString = String(image.metadata?.cfg_scale || image.metadata?.guidance_scale || '');
            const stepsString = String(image.metadata?.steps || image.metadata?.num_inference_steps || '');
            const schedulerString = String(image.scheduler || '');

            return cfgString.includes(lowerCaseQuery) ||
                   stepsString.includes(lowerCaseQuery) ||
                   schedulerString.toLowerCase().includes(lowerCaseQuery);

          default:
            return false;
        }
      });
    }

    // Apply model filter
    if (selectedModels.length > 0) {
      results = results.filter(image => 
        image.models.some(model => {
          // Ensure model is a string before calling toLowerCase
          const modelString = typeof model === 'string' ? model : String(model);
          return selectedModels.some(selectedModel => 
            modelString.toLowerCase().includes(selectedModel.toLowerCase())
          );
        })
      );
    }

    // Apply LoRA filter
    if (selectedLoras.length > 0) {
      console.log('🔍 APPLYING LORA FILTER:', selectedLoras);
      console.log('🔍 TOTAL IMAGES BEFORE LORA FILTER:', results.length);
      
      results = results.filter(image => {
        console.log('🔍 Filtering by LoRA:', { selectedLoras, imageLoras: image.loras });
        return image.loras.some(lora => {
          // Ensure lora is a string before calling toLowerCase
          const loraString = typeof lora === 'string' ? lora : String(lora);
          const match = selectedLoras.some(selectedLora => 
            loraString.toLowerCase().includes(selectedLora.toLowerCase())
          );
          console.log('🔍 LoRA match check:', { lora: loraString, selectedLoras, match });
          return match;
        });
      });
      
      console.log('🔍 TOTAL IMAGES AFTER LORA FILTER:', results.length);
    }

    // Apply scheduler filter
    if (selectedSchedulers.length > 0) {
      console.log('🔍 APPLYING SCHEDULER FILTER:', selectedSchedulers);
      console.log('🔍 TOTAL IMAGES BEFORE SCHEDULER FILTER:', results.length);
      
      results = results.filter(image => {
        const match = image.scheduler && selectedSchedulers.some(selectedScheduler => 
          image.scheduler.toLowerCase().includes(selectedScheduler.toLowerCase())
        );
        console.log('🔍 Scheduler match check:', { 
          scheduler: image.scheduler, 
          selectedSchedulers, 
          match 
        });
        return match;
      });
      
      console.log('🔍 TOTAL IMAGES AFTER SCHEDULER FILTER:', results.length);
    }

    // Apply advanced filters
    if (advancedFilters.dimension) {
      results = results.filter(image => {
        const key = `${image.metadata.width}×${image.metadata.height}`;
        return key === advancedFilters.dimension;
      });
    }

    if (advancedFilters.steps) {
      const { min, max } = advancedFilters.steps;
      results = results.filter(image => {
        const steps = image.metadata?.steps || image.metadata?.num_inference_steps;
        return steps >= min && steps <= max;
      });
    }

    if (advancedFilters.cfg) {
      const { min, max } = advancedFilters.cfg;
      results = results.filter(image => {
        const cfg = image.metadata?.cfg_scale || image.metadata?.guidance_scale;
        return cfg >= min && cfg <= max;
      });
    }

    if (advancedFilters.date) {
      const { from, to } = advancedFilters.date;
      results = results.filter(image => {
        const imageDate = new Date(image.lastModified).toISOString().split('T')[0];
        return imageDate >= from && imageDate <= to;
      });
    }

    // Board filter removed — board info is not reliably available in image metadata

    const sortedResults = sortImages(results);
    setFilteredImages(sortedResults);
    setCurrentPage(1); // Reset to first page when searching/filtering
  }, [searchQuery, images, selectedModels, selectedLoras, selectedSchedulers, advancedFilters, sortImages]);

  // Calculate paginated images
  const paginatedImages = itemsPerPage === 'all' 
    ? filteredImages 
    : filteredImages.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
      );

  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredImages.length / itemsPerPage);

  // Handle image deletion
  const handleImageDeleted = useCallback((imageId: string) => {
    setImages(prevImages => prevImages.filter(img => img.id !== imageId));
    setFilteredImages(prevFiltered => prevFiltered.filter(img => img.id !== imageId));
    setSelectedImage(null);
  }, []);

  // Handle image renaming
  const handleImageRenamed = useCallback((imageId: string, newName: string) => {
    setImages(prevImages => 
      prevImages.map(img => 
        img.id === imageId ? { ...img, name: newName } : img
      )
    );
    setFilteredImages(prevFiltered => 
      prevFiltered.map(img => 
        img.id === imageId ? { ...img, name: newName } : img
      )
    );
    setSelectedImage(null);
  }, []);

  // Handle multiple image selection
  const handleImageSelection = useCallback((image: IndexedImage, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      // Ctrl+Click: toggle selection
      setSelectedImages(prev => {
        const newSelection = new Set(prev);
        if (newSelection.has(image.id)) {
          newSelection.delete(image.id);
        } else {
          newSelection.add(image.id);
        }
        return newSelection;
      });
    } else {
      // Regular click: clear selections and open modal
      setSelectedImages(new Set());
      setSelectedImage(image);
    }
  }, []);

  // Delete selected images
  const handleDeleteSelectedImages = useCallback(async () => {
    if (selectedImages.size === 0) return;
    
    const confirmMessage = selectedImages.size === 1 
      ? 'Are you sure you want to delete this image?' 
      : `Are you sure you want to delete ${selectedImages.size} images?`;
    
    if (!window.confirm(confirmMessage)) return;

    const imagesToDelete = Array.from(selectedImages);
    for (const imageId of imagesToDelete) {
      const image = images.find(img => img.id === imageId);
      if (image) {
        try {
          const result = await FileOperations.deleteFile(image);
          if (result.success) {
            handleImageDeleted(imageId);
          } else {
            alert(`Failed to delete ${image.name}: ${result.error}`);
          }
        } catch (error) {
          alert(`Error deleting ${image.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }
    
    setSelectedImages(new Set());
  }, [selectedImages, images, handleImageDeleted]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedImages(new Set());
  }, []);

  // Navigation functions for modal
  const handleNavigateNext = useCallback(() => {
    if (!selectedImage) return;
    
    const currentIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
    if (currentIndex < filteredImages.length - 1) {
      setSelectedImage(filteredImages[currentIndex + 1]);
    }
  }, [selectedImage, filteredImages]);

  const handleNavigatePrevious = useCallback(() => {
    if (!selectedImage) return;
    
    const currentIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
    if (currentIndex > 0) {
      setSelectedImage(filteredImages[currentIndex - 1]);
    }
  }, [selectedImage, filteredImages]);

  const getCurrentImageIndex = useCallback(() => {
    if (!selectedImage) return 0;
    return filteredImages.findIndex(img => img.id === selectedImage.id);
  }, [selectedImage, filteredImages]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans">
      {/* Sidebar */}
      {directoryHandle && (
        <Sidebar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchField={searchField}
          onSearchFieldChange={setSearchField}
          availableModels={availableModels}
          availableLoras={availableLoras}
          availableSchedulers={availableSchedulers}
          selectedModels={selectedModels}
          selectedLoras={selectedLoras}
          selectedSchedulers={selectedSchedulers}
          onModelChange={setSelectedModels}
          onLoraChange={setSelectedLoras}
          onSchedulerChange={setSelectedSchedulers}
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={setAdvancedFilters}
          onClearAllFilters={() => {
            setSelectedModels([]);
            setSelectedLoras([]);
            setSelectedSchedulers([]);
            setAdvancedFilters({});
          }}
          images={images}
        />
      )}

      {/* Main Content */}
      <div className={`${directoryHandle ? 'ml-80' : ''} min-h-screen`}>
        <header className="bg-gray-800/80 backdrop-blur-sm sticky top-0 z-10 p-4 shadow-lg">
          <div className="container mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.83 2.17C11.42 1.41 10.58 1.41 10.17 2.17L2.17 16.17C1.76 16.93 2.23 18 3 18H21C21.77 18 22.24 16.93 21.83 16.17L13.83 2.17C13.42 1.41 12.58 1.41 12.17 2.17L11.83 2.17Z" fillOpacity="0.01"/>
                <path d="M12 2L3 18H21L12 2ZM12 5.5L18.6 16H5.4L12 5.5Z"/>
              </svg>
              <h1 className="text-2xl font-bold tracking-wider">Local Image Browser</h1>
            </div>
            {directoryHandle && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleUpdateFolder}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
                  title="Refresh current folder"
                >
                  Refresh Folder
                </button>
                <button
                  onClick={handleChangeFolder}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
                  title="Change folder"
                >
                  Change Folder
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Main Content Area */}
        <main className="container mx-auto p-4">
          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg relative my-4" role="alert">
              <strong className="font-bold">Error: </strong>
              <span className="block sm:inline">{error}</span>
            </div>
          )}

          {success && (
            <div className="bg-green-900/50 border border-green-700 text-green-300 px-4 py-3 rounded-lg relative my-4" role="alert">
              <strong className="font-bold">Success: </strong>
              <span className="block sm:inline">{success}</span>
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
                  </div>
                  <div className="text-sm text-gray-400">
                    Searching in <span className="font-mono text-blue-300 bg-gray-800 px-2 py-1 rounded border border-gray-600">{directoryHandle.name}</span>
                    <br />
                    <span className="text-xs">Models: {availableModels.length}, LoRAs: {availableLoras.length}</span>
                  </div>
                </div>
                {(selectedModels.length > 0 || selectedLoras.length > 0 || selectedSchedulers.length > 0) && (
                  <div className="mt-2 text-xs text-gray-400">
                    Active filters:
                    {selectedModels.length > 0 && (
                      <button
                        onClick={() => setSelectedModels([])}
                        className="ml-1 bg-blue-600 text-blue-100 px-2 py-1 rounded hover:bg-blue-700 transition-colors cursor-pointer"
                        title="Click to remove all model filters"
                      >
                        Models ({selectedModels.length}) ×
                      </button>
                    )}
                    {selectedLoras.length > 0 && (
                      <button
                        onClick={() => setSelectedLoras([])}
                        className="ml-1 bg-purple-600 text-purple-100 px-2 py-1 rounded hover:bg-purple-700 transition-colors cursor-pointer"
                        title="Click to remove all LoRA filters"
                      >
                        LoRAs ({selectedLoras.length}) ×
                      </button>
                    )}
                    {selectedSchedulers.length > 0 && (
                      <button
                        onClick={() => setSelectedSchedulers([])}
                        className="ml-1 bg-green-600 text-green-100 px-2 py-1 rounded hover:bg-green-700 transition-colors cursor-pointer"
                        title="Click to remove all scheduler filters"
                      >
                        Schedulers ({selectedSchedulers.length}) ×
                      </button>
                    )}
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

              {/* Selection Toolbar */}
              {selectedImages.size > 0 && (
                <div className="flex items-center justify-between bg-gray-800/50 border border-gray-700/30 rounded-md p-3 mb-4 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-300">
                      {selectedImages.size} selected
                    </span>
                    <button
                      onClick={clearSelection}
                      className="text-gray-500 hover:text-gray-300 transition-colors duration-200 text-xs"
                      title="Clear selection"
                    >
                      Clear
                    </button>
                  </div>
                  <button
                    onClick={handleDeleteSelectedImages}
                    className="text-gray-400 hover:text-red-400 transition-colors duration-200 flex items-center gap-1 text-xs"
                    title={`Delete ${selectedImages.size} selected image${selectedImages.size !== 1 ? 's' : ''}`}
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Delete
                  </button>
                </div>
              )}

              <ImageGrid
                images={paginatedImages}
                onImageClick={handleImageSelection}
                selectedImages={selectedImages}
              />

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

        {selectedImage && (
          <ImageModal
            image={selectedImage}
            onClose={() => {
              setSelectedImage(null);
              setSelectedImages(new Set());
            }}
            onImageDeleted={handleImageDeleted}
            onImageRenamed={handleImageRenamed}
            currentIndex={getCurrentImageIndex()}
            totalImages={filteredImages.length}
            onNavigateNext={handleNavigateNext}
            onNavigatePrevious={handleNavigatePrevious}
            directoryPath={directoryPath}
          />
        )}
      </div>
    </div>
  );
}
