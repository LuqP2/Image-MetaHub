import { useTranslation } from '../i18n/useTranslation';
import { Heart } from 'lucide-react';
import type { InclusionFilterMode } from '../types';
import TriStateToggle, { getNextFilterMode } from './TriStateToggle';
export default function LibraryFavoriteFilter({ favoriteFilterMode, onChange, count }: { favoriteFilterMode: InclusionFilterMode; onChange(mode: InclusionFilterMode): void; count?: number }) {
  const { t } = useTranslation();
  const favoriteBadgeCount = count;
  return (<div className="flex items-center space-x-2 group py-1 px-2 rounded hover:bg-gray-700/50">
    <TriStateToggle
      mode={favoriteFilterMode}
      onClick={() => onChange(getNextFilterMode(favoriteFilterMode))}
      title={t('librarySearch.favoritesFilterModeClickToCycle', { mode: favoriteFilterMode === 'include' ? t('librarySearch.include') : favoriteFilterMode === 'exclude' ? t('librarySearch.exclude') : t('settings.library.off') })}
    />
    <Heart
      className={`w-4 h-4 ${
        favoriteFilterMode === 'include'
          ? 'text-rose-400 fill-rose-400'
          : favoriteFilterMode === 'exclude'
            ? 'text-red-300'
            : 'text-gray-400 group-hover:text-rose-400'
      }`}
    />
    <span className="text-sm text-gray-300 group-hover:text-gray-50 flex-1">
      {favoriteFilterMode === 'include'
        ? t('librarySearch.showFavoritesOnly')
        : favoriteFilterMode === 'exclude'
          ? t('librarySearch.excludeFavoritesToggle')
          : t('librarySearch.favorites')}
    </span>
    <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded border border-gray-600">
      {favoriteBadgeCount}
    </span>
  </div>);
}
