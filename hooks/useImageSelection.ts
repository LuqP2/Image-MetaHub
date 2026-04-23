import { useCallback } from 'react';
import { useImageStore } from '../store/useImageStore';
import { IndexedImage } from '../types';
import { FileOperations } from '../services/fileOperations';

export function useImageSelection() {
    const {
        setSelectedImage,
        toggleImageSelection,
        clearImageSelection,
        removeImages,
        setError,
        setFocusedImageIndex,
    } = useImageStore();

    const handleImageSelection = useCallback((image: IndexedImage, event: React.MouseEvent) => {
        const { activeImageScope, filteredImages, selectedImage, selectedImages } = useImageStore.getState();
        const selectionScope = activeImageScope ?? filteredImages;

        // Update focused index
        const clickedIndex = selectionScope.findIndex(img => img.id === image.id);
        if (clickedIndex !== -1) {
            setFocusedImageIndex(clickedIndex);
        }

        if (event.shiftKey && selectedImage) {
            const lastSelectedIndex = selectionScope.findIndex(img => img.id === selectedImage.id);
            const clickedIndex = selectionScope.findIndex(img => img.id === image.id);
            if (lastSelectedIndex !== -1 && clickedIndex !== -1) {
                const start = Math.min(lastSelectedIndex, clickedIndex);
                const end = Math.max(lastSelectedIndex, clickedIndex);
                const rangeIds = selectionScope.slice(start, end + 1).map(img => img.id);
                const newSelection = new Set(selectedImages);
                rangeIds.forEach(id => newSelection.add(id));
                useImageStore.setState({ selectedImages: newSelection });
                return;
            }
        }

        if (event.ctrlKey || event.metaKey) {
            toggleImageSelection(image.id);
        } else {
            setSelectedImage(image);
        }
    }, [toggleImageSelection, setSelectedImage, setFocusedImageIndex]);

    const handleDeleteSelectedImages = useCallback(async () => {
        const { selectedImages, images, directories } = useImageStore.getState();
        if (selectedImages.size === 0) return;

        const confirmMessage = `Are you sure you want to delete ${selectedImages.size} image(s)?`;
        if (!window.confirm(confirmMessage)) return;

        const imagesToDelete = Array.from(selectedImages);
        const deletedIdsHandledLocally: string[] = [];
        const deletedIdsAwaitingWatcher: string[] = [];

        for (const imageId of imagesToDelete) {
            const image = images.find(img => img.id === imageId);
            if (image) {
                try {
                    const result = await FileOperations.deleteFile(image);
                    if (result.success) {
                        const watchedDirectory = directories.find((directory) => directory.id === image.directoryId);
                        const shouldAwaitWatcherRemoval = Boolean(window.electronAPI && watchedDirectory?.autoWatch);

                        if (shouldAwaitWatcherRemoval) {
                            deletedIdsAwaitingWatcher.push(imageId);
                        } else {
                            deletedIdsHandledLocally.push(imageId);
                        }
                    } else {
                        setError(`Failed to delete ${image.name}: ${result.error}`);
                    }
                } catch (err) {
                    setError(`Error deleting ${image.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
            }
        }

        if (deletedIdsHandledLocally.length > 0) {
            removeImages(deletedIdsHandledLocally);
        }

        const deletedIds = [...deletedIdsHandledLocally, ...deletedIdsAwaitingWatcher];
        if (deletedIds.length > 0) {
            const deletedIdSet = new Set(deletedIds);
            useImageStore.setState((state) => ({
                selectedImages: new Set(Array.from(state.selectedImages).filter((id) => !deletedIdSet.has(id))),
                previewImage: state.previewImage && deletedIdSet.has(state.previewImage.id) ? null : state.previewImage,
                selectedImage: state.selectedImage && deletedIdSet.has(state.selectedImage.id) ? null : state.selectedImage,
                comparisonImages: state.comparisonImages.filter((image) => !deletedIdSet.has(image.id)),
            }));
        } else {
            clearImageSelection();
        }
    }, [removeImages, setError, clearImageSelection]);

    return { handleImageSelection, handleDeleteSelectedImages, clearSelection: clearImageSelection };
}
