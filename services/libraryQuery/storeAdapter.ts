import type { LibraryWorkerCriteria } from './types';
import type { Directory, SortOrder } from '../../types';

type State = Omit<LibraryWorkerCriteria, 'visibleDirectories' | 'safeMode' | 'selectedFolders' | 'excludedFolders' | 'sortOrder'> & {
  directories: Directory[];
  selectedFolders: Set<string>;
  excludedFolders: Set<string>;
  sortOrder: SortOrder;
};
export function captureWorkerCriteria(state: State, settings: LibraryWorkerCriteria['safeMode']) {
  const { sensitiveTags, blurSensitiveImages, enableSafeMode } = settings;
        return {
            searchQuery: state.searchQuery,
            selectedModels: [...state.selectedModels],
            excludedModels: [...state.excludedModels],
            selectedLoras: [...state.selectedLoras],
            excludedLoras: [...state.excludedLoras],
            selectedSamplers: [...state.selectedSamplers],
            excludedSamplers: [...state.excludedSamplers],
            selectedSchedulers: [...state.selectedSchedulers],
            excludedSchedulers: [...state.excludedSchedulers],
            selectedGenerators: [...state.selectedGenerators],
            excludedGenerators: [...state.excludedGenerators],
            selectedGpuDevices: [...state.selectedGpuDevices],
            excludedGpuDevices: [...state.excludedGpuDevices],
            selectedTags: [...state.selectedTags],
            selectedTagsMatchMode: state.selectedTagsMatchMode,
            excludedTags: [...state.excludedTags],
            selectedAutoTags: [...state.selectedAutoTags],
            excludedAutoTags: [...state.excludedAutoTags],
            favoriteFilterMode: state.favoriteFilterMode,
            selectedRatings: [...state.selectedRatings],
            advancedFilters: state.advancedFilters,
            sortOrder: state.sortOrder,
            randomSeed: state.randomSeed,
            selectedFolders: Array.from(state.selectedFolders).sort(),
            excludedFolders: Array.from(state.excludedFolders).sort(),
            includeSubfolders: state.includeSubfolders,
            visibleDirectories: state.directories
                .filter(dir => dir.visible ?? true)
                .map(dir => ({ id: dir.id, path: dir.path })),
            safeMode: {
                enableSafeMode,
                blurSensitiveImages,
                sensitiveTags: (sensitiveTags ?? [])
                    .map(tag => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
                    .filter(Boolean),
            },
        };

}
