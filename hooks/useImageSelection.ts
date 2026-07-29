import { useCallback } from 'react';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { IndexedImage } from '../types';
import { FileOperations } from '../services/fileOperations';
import cacheManager from '../services/cacheManager';

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
            focusedImageIndex,
            previewImage,
            selectedImage,
            selectedImages,
            getScopedFilteredImages,
        } = useImageStore.getState();
        // The displayed set (filtered ∩ node filter ∩ scope), so shift-click ranges never
        // include images hidden by the active filters.
        const selectionScope = getScopedFilteredImages();

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
        const { selectedImages, images } = useImageStore.getState();
        const { skipDeleteConfirmation } = useSettingsStore.getState();
        if (selectedImages.size === 0) return;
        if (isDeletingSelectedImages) return;

        isDeletingSelectedImages = true;

        try {
            if (!skipDeleteConfirmation) {
                const confirmMessage = `Are you sure you want to delete ${selectedImages.size} image(s)?`;
                if (!window.confirm(confirmMessage)) return;
            }

            const imagesToDelete = Array.from(selectedImages);
            const imageById = new Map(images.map((img) => [img.id, img]));

            // Directories are no longer consulted to decide whether to wait for the
            // watcher: removeImages is a no-op when the ids are already gone (see
            // useImageStore), so removing locally right away and letting a later
            // watcher event land as a harmless no-op is strictly faster than waiting.
            const deletions = await Promise.all(imagesToDelete.map(async (imageId) => {
                const image = imageById.get(imageId);
                if (!image) return null;
                try {
                    const result = await FileOperations.deleteFile(image);
                    if (result.success) {
                        return imageId;
                    }
                    setError(`Failed to delete ${image.name}: ${result.error}`);
                } catch (err) {
                    setError(`Error deleting ${image.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
                return null;
            }));

            const deletedIds = deletions.filter((id): id is string => id !== null);
            if (deletedIds.length > 0) {
                const deletedIdSet = new Set(deletedIds);
                removeImages(deletedIds);
                useImageStore.setState((state) => ({
                    selectedImages: new Set(Array.from(state.selectedImages).filter((id) => !deletedIdSet.has(id))),
                    previewImage: state.previewImage && deletedIdSet.has(state.previewImage.id) ? null : state.previewImage,
                    selectedImage: state.selectedImage && deletedIdSet.has(state.selectedImage.id) ? null : state.selectedImage,
                    comparisonImages: state.comparisonImages.filter((image) => !deletedIdSet.has(image.id)),
                }));

                // Keep the on-disk cache in sync right away (by id, while we still
                // know it), instead of waiting on the watcher event to prune it —
                // see cacheManager.removeCachedImages for the chunk-scoped fast path.
                const { directories, scanSubfolders } = useImageStore.getState();
                const idsByDirectory = new Map<string, string[]>();
                for (const imageId of deletedIds) {
                    const image = imageById.get(imageId);
                    if (!image?.directoryId) continue;
                    const list = idsByDirectory.get(image.directoryId);
                    if (list) list.push(imageId);
                    else idsByDirectory.set(image.directoryId, [imageId]);
                }
                for (const [directoryId, ids] of idsByDirectory) {
                    const directory = directories.find((dir) => dir.id === directoryId);
                    if (!directory) continue;
                    void cacheManager
                        .removeCachedImages(directory.path, directory.name, ids, [], scanSubfolders)
                        .catch((err) => console.error('Failed to update cache after delete:', err));
                }
            } else {
                clearImageSelection();
            }
        } finally {
            isDeletingSelectedImages = false;
        }
    }, [removeImages, setError, clearImageSelection]);

    return { handleImageSelection, handleDeleteSelectedImages, clearSelection: clearImageSelection };
}
