import { useEffect, useMemo } from 'react';
import hotkeyManager from '../services/hotkeyManager';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageSelection } from './useImageSelection';
import { useImageLoader } from './useImageLoader';
import { useFeatureAccess } from './useFeatureAccess';
import { transferIndexedImages } from '../services/fileTransferService';
import type { Directory } from '../types';

interface HotkeyProps {
  isCommandPaletteOpen: boolean;
  setIsCommandPaletteOpen: (isOpen: boolean) => void;
  isHotkeyHelpOpen: boolean;
  setIsHotkeyHelpOpen: (isOpen: boolean) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (isOpen: boolean) => void;
}

const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');

const getRelativePath = (rootPath: string, targetPath: string) => {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = normalizePath(targetPath);
  if (normalizedRoot === normalizedTarget) return '';
  return normalizedTarget.startsWith(`${normalizedRoot}/`)
    ? normalizedTarget.slice(normalizedRoot.length + 1)
    : '';
};

const createTransferDestination = (directories: Directory[], destinationPath: string) => {
  const normalizedDestination = normalizePath(destinationPath).toLowerCase();
  const rootDirectory = directories
    .filter((directory) => {
      const normalizedRoot = normalizePath(directory.path).toLowerCase();
      return normalizedDestination === normalizedRoot || normalizedDestination.startsWith(`${normalizedRoot}/`);
    })
    .sort((a, b) => b.path.length - a.path.length)[0];

  if (!rootDirectory) return null;

  const relativePath = getRelativePath(rootDirectory.path, destinationPath);
  return {
    ...rootDirectory,
    path: destinationPath,
    name: relativePath || rootDirectory.name,
    rootDirectoryPath: rootDirectory.path,
    destinationRelativePath: relativePath,
    displayName: relativePath ? `${rootDirectory.name}/${relativePath}` : rootDirectory.name,
  };
};

export const useHotkeys = ({
  isCommandPaletteOpen,
  setIsCommandPaletteOpen,
  isHotkeyHelpOpen,
  setIsHotkeyHelpOpen,
  isSettingsModalOpen,
  setIsSettingsModalOpen,
}: HotkeyProps) => {
  const {
    selectedImage,
    setSelectedImage,
    selectedImages,
    clearImageSelection,
    setPreviewImage,
    previewImage,
    directories,
    handleNavigateNext,
    handleNavigatePrevious,
    selectAllImages,
  } = useImageStore();

  const { handleDeleteSelectedImages } = useImageSelection();
  const { handleSelectFolder, handleLoadFromStorage } = useImageLoader();
  const { toggleViewMode, theme, setTheme, keymap } = useSettingsStore();
  const { canUseFileManagement, showProModal } = useFeatureAccess();

  const focusArea = (area: 'sidebar' | 'grid' | 'preview') => {
    const selector = area === 'sidebar'
      ? '[data-sidebar-tree="true"]'
      : `[data-area='${area}']`;
    const element = document.querySelector<HTMLElement>(selector);
    if (element) {
      element.focus();
    }
  };

  useEffect(() => {
    // Register all actions with the hotkey manager
    hotkeyManager.registerAction('openCommandPalette', () => setIsCommandPaletteOpen(true));
    hotkeyManager.registerAction('openQuickSettings', () => setIsSettingsModalOpen(true));
    hotkeyManager.registerAction('openKeyboardShortcuts', () => setIsHotkeyHelpOpen(true));
    hotkeyManager.registerAction('focusSidebar', () => focusArea('sidebar'));
    hotkeyManager.registerAction('focusImageGrid', () => focusArea('grid'));
    hotkeyManager.registerAction('focusPreviewPane', () => focusArea('preview'));
    hotkeyManager.registerAction('focusSearch', () => {
      const searchInput = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    });
    hotkeyManager.registerAction('quickSearch', () => {
        const searchInput = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
    });
    hotkeyManager.registerAction('toggleAdvancedFilters', () => {
      const advancedFilterButton = document.querySelector<HTMLButtonElement>('button:has(span:contains("Advanced Filters"))');
      if (advancedFilterButton) {
        advancedFilterButton.click();
      }
    });
    hotkeyManager.registerAction('addFolder', () => {
      handleSelectFolder();
    });
    hotkeyManager.registerAction('rescanFolders', () => {
      handleLoadFromStorage().catch((error) => {
        console.error('Error rescanning folders:', error);
      });
    });
    hotkeyManager.registerAction('selectAll', selectAllImages);
    hotkeyManager.registerAction('deleteSelected', () => {
      // If an image is open in the modal, do not trigger global delete
      if (useImageStore.getState().selectedImage) return;

      handleDeleteSelectedImages().catch((error) => {
        console.error('Error deleting selected images:', error);
      });
    });
    hotkeyManager.registerAction('toggleQuickPreview', () => {
      if (selectedImage) {
        setPreviewImage(previewImage?.id === selectedImage.id ? null : selectedImage);
      }
    });
    hotkeyManager.registerAction('openFullscreen', () => {
      if (selectedImage) {
        setSelectedImage(selectedImage);
      }
    });
    hotkeyManager.registerAction('toggleListGridView', toggleViewMode);
    hotkeyManager.registerAction('navigatePrevious', handleNavigatePrevious);
    hotkeyManager.registerAction('navigateNext', handleNavigateNext);

    hotkeyManager.registerAction('copyImages', () => {
      const state = useImageStore.getState();
      const imageIds = state.selectedImages.size > 0
        ? Array.from(state.selectedImages)
        : state.selectedImage
          ? [state.selectedImage.id]
          : [];
      if (imageIds.length === 0) return;
      if (!canUseFileManagement) {
        showProModal('file_management');
        return;
      }
      state.setClipboard({
        imageIds,
        mode: 'copy',
      });
      state.setSuccess(`${imageIds.length} image${imageIds.length === 1 ? '' : 's'} copied.`);
    });

    hotkeyManager.registerAction('cutImages', () => {
      const state = useImageStore.getState();
      const imageIds = state.selectedImages.size > 0
        ? Array.from(state.selectedImages)
        : state.selectedImage
          ? [state.selectedImage.id]
          : [];
      if (imageIds.length === 0) return;
      if (!canUseFileManagement) {
        showProModal('file_management');
        return;
      }
      state.setClipboard({
        imageIds,
        mode: 'move',
      });
      state.setSuccess(`${imageIds.length} image${imageIds.length === 1 ? '' : 's'} ready to move.`);
    });

    hotkeyManager.registerAction('pasteImages', () => {
      (async () => {
        if (!canUseFileManagement) {
          showProModal('file_management');
          return;
        }
        const state = useImageStore.getState();
        const clipboard = state.clipboard;
        if (!clipboard || clipboard.imageIds.length === 0) return;

        const destPath = Array.from(state.selectedFolders)[0];
        if (!destPath) {
          state.setError('Select a destination folder before pasting images.');
          return;
        }

        const destinationDirectory = createTransferDestination(state.directories, destPath);
        const imagesToTransfer = state.images.filter(img => clipboard.imageIds.includes(img.id));
        if (imagesToTransfer.length > 0 && destinationDirectory) {
          try {
            await transferIndexedImages({
              images: imagesToTransfer,
              destinationDirectory,
              mode: clipboard.mode,
            });
            if (clipboard.mode === 'move') {
              state.setClipboard(null);
            }
            if (!destinationDirectory.autoWatch) {
               handleLoadFromStorage().catch(console.error);
            }
          } catch (err) {
            console.error('Paste failed:', err);
          }
        }
      })();
    });

    hotkeyManager.registerAction('closeModalsOrClearSelection', () => {
      if (isCommandPaletteOpen) setIsCommandPaletteOpen(false);
      else if (isHotkeyHelpOpen) setIsHotkeyHelpOpen(false);
      else if (isSettingsModalOpen) setIsSettingsModalOpen(false);
      else if (selectedImage) setSelectedImage(null);
      else if (previewImage) setPreviewImage(null);
      else if (selectedImages.size > 0) clearImageSelection();
    });

    // Bind all registered actions initially
    hotkeyManager.bindAllActions();

    // Set scope based on focused element
    const handleFocusChange = () => {
      const activeElement = document.activeElement;
      if (activeElement) {
        const previewPane = document.querySelector('[data-area="preview"]');
        if (previewPane && previewPane.contains(activeElement)) {
          hotkeyManager.setScope('preview');
        } else {
          hotkeyManager.setScope('global');
        }
      }
    };

    document.addEventListener('focusin', handleFocusChange);

    // Subscribe to keymap changes and re-bind hotkeys
    const unsubscribe = useSettingsStore.subscribe((state) => {
      if (state.keymap) {
        hotkeyManager.bindAllActions();
      }
    });

    return () => {
      hotkeyManager.clearActions();
      document.removeEventListener('focusin', handleFocusChange);
      unsubscribe();
    };
  }, [
    handleSelectFolder,
    handleLoadFromStorage,
    selectAllImages,
    handleDeleteSelectedImages,
    selectedImage,
    previewImage,
    setPreviewImage,
    setSelectedImage,
    handleNavigatePrevious,
    handleNavigateNext,
    canUseFileManagement,
    showProModal,
    isCommandPaletteOpen,
    isHotkeyHelpOpen,
    isSettingsModalOpen,
    selectedImages,
    clearImageSelection,
    toggleViewMode,
    setIsCommandPaletteOpen,
    setIsHotkeyHelpOpen,
    setIsSettingsModalOpen,
  ]);

  const commands = useMemo(() => [
    { id: 'toggle-theme', name: 'Toggle Theme', description: 'Switch between light and dark mode', action: () => {
      const newTheme = theme === 'dark' ? 'light' : 'dark';
      setTheme(newTheme);
    }},
    { id: 'add-folder', name: 'Add Folder', description: 'Open a new folder', hotkey: 'Ctrl+O', action: handleSelectFolder },
    { id: 'toggle-view', name: 'Toggle List/Grid View', description: 'Switch between list and grid view', hotkey: 'Ctrl+L', action: toggleViewMode },
    ...directories.map(dir => ({
      id: `open-folder-${dir.id}`,
      name: `Go to Folder: ${dir.name}`,
      description: `Focus on the ${dir.name} folder`,
      action: () => {
        useImageStore.getState().toggleDirectoryVisibility(dir.id);
      }
    }))
  ], [directories, handleSelectFolder, toggleViewMode, theme, setTheme]);

  return { commands, registeredHotkeys: hotkeyManager.getRegisteredHotkeys() };
};
