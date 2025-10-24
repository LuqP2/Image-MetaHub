import React, { useCallback } from 'react';
import { useImageStore } from '../store/useImageStore';
import { IndexedImage } from '../types';
import { FileOperations } from '../services/fileOperations';
import { cacheManager } from '../services/cacheManager';
import { deleteLockManager } from '../utils/deleteLockManager';

export function useImageSelection() {
    const {
        images,
        filteredImages,
        selectedImage,
        selectedImages,
        setSelectedImage,
        setShouldOpenModal,
        toggleImageSelection,
        clearImageSelection,
        removeImage,
        setError,
    } = useImageStore();

    const handleImageSelection = useCallback((image: IndexedImage, event: React.MouseEvent) => {
        // Shift+Click: Range selection from last selected to clicked
        if (event.shiftKey) {
            // Find the last selected image (either from selectedImage or from selectedImages)
            let lastSelectedIndex = -1;
            if (selectedImage) {
                lastSelectedIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
            } else if (selectedImages.size > 0) {
                const lastId = Array.from(selectedImages)[selectedImages.size - 1];
                lastSelectedIndex = filteredImages.findIndex(img => img.id === lastId);
            } else {
                // No previous selection, start range from clicked image
                lastSelectedIndex = filteredImages.findIndex(img => img.id === image.id);
            }
            
            const clickedIndex = filteredImages.findIndex(img => img.id === image.id);
            
            if (lastSelectedIndex !== -1 && clickedIndex !== -1) {
                const start = Math.min(lastSelectedIndex, clickedIndex);
                const end = Math.max(lastSelectedIndex, clickedIndex);
                const rangeIds = filteredImages.slice(start, end + 1).map(img => img.id);
                useImageStore.setState({ 
                    selectedImages: new Set(rangeIds),
                    shouldOpenModal: false
                });
                return;
            }
        }

        // Ctrl+Click: Toggle individual selection (don't open modal)
        if (event.ctrlKey || event.metaKey) {
            toggleImageSelection(image.id);
            setShouldOpenModal(false);
            return;
        } 
        
        // Regular click: Single selection (opens modal)
        clearImageSelection();
        setSelectedImage(image);
        setShouldOpenModal(true);
    }, [filteredImages, selectedImage, selectedImages, toggleImageSelection, clearImageSelection, setSelectedImage, setShouldOpenModal]);

    const handleDeleteSelectedImages = useCallback(async () => {
        if (deleteLockManager.isLocked()) return;
        deleteLockManager.lock();
        const imagesToDelete: IndexedImage[] = [];

        // Prioritize multi-selection
        if (selectedImages.size > 0) {
            const imageIds = Array.from(selectedImages);
            imageIds.forEach(id => {
                const img = images.find(i => i.id === id);
                if (img) imagesToDelete.push(img);
            });
        } 
        // Fallback to single selection (highlighted image)
        else if (selectedImage) {
            imagesToDelete.push(selectedImage);
        }

        if (imagesToDelete.length === 0) return;

        // Always use the same confirmation message for grid
        const confirmMessage = `Are you sure you want to delete ${imagesToDelete.length} image(s)?`;
        if (!window.confirm(confirmMessage)) return;

        const deletedImageIds: string[] = [];
        for (const image of imagesToDelete) {
            try {
                const result = await FileOperations.deleteFile(image);
                if (result.success) {
                    removeImage(image.id);
                    deletedImageIds.push(image.id);
                } else {
                    setError(`Failed to delete ${image.name}: ${result.error}`);
                }
            } catch (err) {
                setError(`Error deleting ${image.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
        }

        if (deletedImageIds.length > 0) {
            await cacheManager.removeImages(deletedImageIds);
        }

        // Clear all selections after deletion
        clearImageSelection();
        setSelectedImage(null);

    }, [selectedImage, selectedImages, images, removeImage, setError, clearImageSelection, setSelectedImage]);

    return { handleImageSelection, handleDeleteSelectedImages, clearSelection: clearImageSelection };
}