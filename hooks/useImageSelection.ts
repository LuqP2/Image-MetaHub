import { useCallback } from 'react';
import { useImageStore } from '../store/useImageStore';
import { IndexedImage } from '../types';
import { FileOperations } from '../services/fileOperations';

let isDeletingSelectedImages = false;

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
        const {
            activeImageScope,
            filteredImages,
            focusedImageIndex,
            previewImage,
            selectedImage,
            selectedImages,
        } = useImageStore.getState();
        const selectionScope = activeImageScope ?? filteredImages;

        // Update focused index
        const clickedIndex = selectionScope.findIndex(img => img.id === image.id);
        if (clickedIndex !== -1) {
            setFocusedImageIndex(clickedIndex);
        }

        const focusedAnchor =
            typeof focusedImageIndex === 'number' && focusedImageIndex >= 0
                ? selectionScope[focusedImageIndex]
                : null;
        const anchorCandidates = [selectedImage, previewImage, focusedAnchor].filter(
            (candidate): candidate is IndexedImage => Boolean(candidate)
        );
        let selectionAnchor: IndexedImage | null = null;
        let selectionAnchorIndex = -1;

        for (const candidate of anchorCandidates) {
            const candidateIndex = selectionScope.findIndex(img => img.id === candidate.id);
            if (candidateIndex !== -1) {
                selectionAnchor = candidate;
                selectionAnchorIndex = candidateIndex;
                break;
            }
        }

        if (event.shiftKey && selectionAnchor) {
            if (selectionAnchorIndex !== -1 && clickedIndex !== -1) {
                const start = Math.min(selectionAnchorIndex, clickedIndex);
                const end = Math.max(selectionAnchorIndex, clickedIndex);
                const rangeIds = selectionScope.slice(start, end + 1).map(img => img.id);
                const newSelection = new Set(selectedImages);
                rangeIds.forEach(id => newSelection.add(id));
                useImageStore.setState({ selectedImages: newSelection });
                return;
            }
        }

        if (event.ctrlKey || event.metaKey) {
            if (selectedImages.size === 0 && selectionAnchor && selectionAnchor.id !== image.id) {
                useImageStore.setState({ selectedImages: new Set([selectionAnchor.id, image.id]) });
                return;
            }

            toggleImageSelection(image.id);
        } else {
            setSelectedImage(image);
        }
    }, [toggleImageSelection, setSelectedImage, setFocusedImageIndex]);

    const handleDeleteSelectedImages = useCallback(async () => {
        const { selectedImages, images, directories } = useImageStore.getState();
        if (selectedImages.size === 0) return;
        if (isDeletingSelectedImages) return;

        isDeletingSelectedImages = true;

        try {
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
        } finally {
            isDeletingSelectedImages = false;
        }
    }, [removeImages, setError, clearImageSelection]);

    return { handleImageSelection, handleDeleteSelectedImages, clearSelection: clearImageSelection };
}
