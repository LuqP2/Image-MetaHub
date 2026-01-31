import { useCallback } from 'react';
import { useImageStore } from '../store/useImageStore';
import { IndexedImage } from '../types';
import { FileOperations } from '../services/fileOperations';

export function useImageSelection() {
    const {
        images,
        filteredImages,
        selectedImage,
        selectedImages,
        setSelectedImage,
        toggleImageSelection,
        clearImageSelection,
        removeImage,
        setError,
        setFocusedImageIndex,
    } = useImageStore();

    const handleImageSelection = useCallback((image: IndexedImage, event: React.MouseEvent) => {
        // Update focused index
        const clickedIndex = filteredImages.findIndex(img => img.id === image.id);
        if (clickedIndex !== -1) {
            setFocusedImageIndex(clickedIndex);
        }

        if (event.shiftKey && selectedImage) {
            const lastSelectedIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
            const clickedIndex = filteredImages.findIndex(img => img.id === image.id);
            if (lastSelectedIndex !== -1 && clickedIndex !== -1) {
                const start = Math.min(lastSelectedIndex, clickedIndex);
                const end = Math.max(lastSelectedIndex, clickedIndex);
                const rangeIds = filteredImages.slice(start, end + 1).map(img => img.id);
                const newSelection = new Set(selectedImages);
                rangeIds.forEach(id => newSelection.add(id));
                useImageStore.setState({ selectedImages: newSelection });
                return;
            }
        }

        if (event.ctrlKey || event.metaKey) {
            toggleImageSelection(image.id);
        } else {
            // Single selection: Clear previous, set new selected image, AND update the set
            // The set update is critical for the Selection Toolbar to appear
            setSelectedImage(image);
            useImageStore.setState({ selectedImages: new Set([image.id]) });
        }
    }, [filteredImages, selectedImage, selectedImages, toggleImageSelection, clearImageSelection, setSelectedImage, setFocusedImageIndex]);

    const handleDeleteSelectedImages = useCallback(async () => {
        if (selectedImages.size === 0) return;

        const confirmMessage = `Are you sure you want to delete ${selectedImages.size} image(s)?`;
        if (!window.confirm(confirmMessage)) return;

        const imagesToDelete = Array.from(selectedImages);
        for (const imageId of imagesToDelete) {
            const image = images.find(img => img.id === imageId);
            if (image) {
                try {
                    const result = await FileOperations.deleteFile(image);
                    if (result.success) {
                        removeImage(imageId);
                    } else {
                        setError(`Failed to delete ${image.name}: ${result.error}`);
                    }
                } catch (err) {
                    setError(`Error deleting ${image.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
            }
        }
        clearImageSelection();
    }, [selectedImages, images, removeImage, setError, clearImageSelection]);

    return { handleImageSelection, handleDeleteSelectedImages, clearSelection: clearImageSelection };
}