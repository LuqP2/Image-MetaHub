import { useEffect, useCallback } from 'react';
import { useImageStore } from '../store/useImageStore';
import { IndexedImage } from '../types';

interface ImageFilterProps {
    images: IndexedImage[];
    searchQuery: string;
    selectedModels: string[];
    selectedLoras: string[];
    selectedSchedulers: string[];
    sortOrder: 'asc' | 'desc' | 'date-asc' | 'date-desc';
}

export function useImageFilters({
    images,
    searchQuery,
    selectedModels,
    selectedLoras,
    selectedSchedulers,
    sortOrder,
}: ImageFilterProps) {
    const setFilteredImages = useImageStore(state => state.setFilteredImages);

    const sortImages = useCallback((imagesToSort: IndexedImage[]) => {
        // Create a new array to avoid mutating the original
        return [...imagesToSort].sort((a, b) => {
            if (sortOrder === 'asc') return a.name.localeCompare(b.name);
            if (sortOrder === 'desc') return b.name.localeCompare(a.name);
            if (sortOrder === 'date-asc') return a.lastModified - b.lastModified;
            if (sortOrder === 'date-desc') return b.lastModified - a.lastModified;
            return 0;
        });
    }, [sortOrder]);

    useEffect(() => {
        let results = images;

        if (searchQuery) {
            const lowerCaseQuery = searchQuery.toLowerCase();
            results = results.filter(image =>
                image.metadataString.toLowerCase().includes(lowerCaseQuery)
            );
        }

        if (selectedModels.length > 0) {
            results = results.filter(image =>
                selectedModels.some(sm => image.models.includes(sm))
            );
        }

        if (selectedLoras.length > 0) {
            results = results.filter(image =>
                selectedLoras.some(sl => image.loras.includes(sl))
            );
        }

        if (selectedSchedulers.length > 0) {
            results = results.filter(image =>
                selectedSchedulers.includes(image.scheduler)
            );
        }

        const sorted = sortImages(results);
        setFilteredImages(sorted);

    }, [images, searchQuery, selectedModels, selectedLoras, selectedSchedulers, sortOrder, sortImages, setFilteredImages]);
}