import React, { useMemo, useState } from 'react';
import { Star, Archive, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import type { ImageCluster, IndexedImage, ClusterPreference } from '../types';
import {
  suggestDuplicates,
  calculateDeduplicationStats,
  formatBytes,
  type DeduplicationSuggestion,
} from '../services/deduplicationEngine';
import { markAsBest, markForArchive, getClusterPreference } from '../services/imageAnnotationsStorage';
import { useImageStore } from '../store/useImageStore';

interface DeduplicationHelperProps {
  cluster: ImageCluster;
  images: IndexedImage[];
  existingPreference?: ClusterPreference | null;
  onPreferenceUpdated?: () => void;
}

const DeduplicationHelper: React.FC<DeduplicationHelperProps> = ({
  cluster,
  images,
  existingPreference,
  onPreferenceUpdated,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Generate deduplication suggestion
  const suggestion: DeduplicationSuggestion = useMemo(() => {
    return suggestDuplicates(cluster, images, existingPreference, {
      keepPercentage: 0.2,
      minKeepCount: 1,
      maxKeepCount: 10,
      respectUserChoices: true,
    });
  }, [cluster, images, existingPreference]);

  const stats = useMemo(() => {
    return calculateDeduplicationStats(suggestion);
  }, [suggestion]);

  // Check if suggestions are empty (nothing to do)
  const hasNoSuggestions = stats.bestCount === 0 && stats.duplicateCount === 0;

  // Check if user has already applied preferences
  const hasUserPreferences =
    stats.userMarkedBestCount > 0 || stats.userArchivedCount > 0;

  const handleApplySuggestions = async () => {
    setIsApplying(true);
    try {
      // Mark best images
      const bestImageIds = suggestion.bestImages.map((img) => img.id);
      if (bestImageIds.length > 0) {
        await markAsBest(cluster.id, bestImageIds);
      }

      // Mark duplicates for archive
      const duplicateImageIds = suggestion.duplicates.map((img) => img.id);
      if (duplicateImageIds.length > 0) {
        await markForArchive(cluster.id, duplicateImageIds);
      }

      // Notify parent to refresh
      onPreferenceUpdated?.();

      // Show success feedback
      console.log(
        `Applied suggestions: ${bestImageIds.length} best, ${duplicateImageIds.length} to archive`
      );
    } catch (error) {
      console.error('Failed to apply deduplication suggestions:', error);
    } finally {
      setIsApplying(false);
    }
  };

  const handleClearAll = async () => {
    setIsApplying(true);
    try {
      // Clear all preferences by saving empty arrays
      await markAsBest(cluster.id, []);
      await markForArchive(cluster.id, []);

      // Notify parent to refresh
      onPreferenceUpdated?.();

      console.log('Cleared all deduplication preferences');
    } catch (error) {
      console.error('Failed to clear preferences:', error);
    } finally {
      setIsApplying(false);
    }
  };

  // Don't show if cluster has less than 3 images (nothing to deduplicate)
  if (images.length < 3) {
    return null;
  }

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Archive className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-semibold text-gray-100">
            Deduplication Helper [Experimental]
          </span>
          {hasUserPreferences && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
              Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <div className="flex items-center gap-1">
              <Star className="w-3.5 h-3.5 text-yellow-400" />
              <span>
                {stats.bestCount} best
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Archive className="w-3.5 h-3.5 text-gray-400" />
              <span>
                {stats.duplicateCount} duplicates
              </span>
            </div>
            {stats.potentialSpaceSaved > 0 && (
              <span className="text-green-400">
                {formatBytes(stats.potentialSpaceSaved)} saved
              </span>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-800 p-4 space-y-4">
          {/* Info section */}
          <div className="text-xs text-gray-400 leading-relaxed space-y-2">
            <p>
              The deduplication algorithm analyzes images in this cluster and suggests
              which to keep (best quality) vs archive (potential duplicates).
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="bg-gray-800/40 rounded-lg p-3">
                <div className="text-xs font-semibold text-gray-300 mb-1">
                  Keep (Best)
                </div>
                <div className="text-lg font-bold text-yellow-400">
                  {stats.bestCount}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Top {Math.round((stats.bestCount / stats.totalImages) * 100)}% by quality
                </div>
              </div>
              <div className="bg-gray-800/40 rounded-lg p-3">
                <div className="text-xs font-semibold text-gray-300 mb-1">
                  Archive
                </div>
                <div className="text-lg font-bold text-gray-400">
                  {stats.duplicateCount}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Potential duplicates
                </div>
              </div>
            </div>

            {hasUserPreferences && (
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 mt-3">
                <div className="text-xs font-semibold text-purple-300 mb-1">
                  Your Choices
                </div>
                <div className="text-xs text-purple-200">
                  {stats.userMarkedBestCount > 0 && (
                    <div>
                      <Star className="inline w-3 h-3 mr-1" />
                      {stats.userMarkedBestCount} manually marked as best
                    </div>
                  )}
                  {stats.userArchivedCount > 0 && (
                    <div>
                      <Archive className="inline w-3 h-3 mr-1" />
                      {stats.userArchivedCount} manually marked for archive
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleApplySuggestions}
              disabled={isApplying || hasNoSuggestions}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {isApplying ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Star className="w-3.5 h-3.5" />
                  Apply Suggestions
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isApplying || !hasUserPreferences}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-gray-300 hover:text-white hover:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Clear All
            </button>
          </div>

          {/* Help text */}
          <div className="text-xs text-gray-500 pt-2 border-t border-gray-800">
            <strong>How it works:</strong> Images are ranked by favorites (highest priority),
            file size (larger = better quality), and creation date (earlier = original).
            Top 20% are suggested as "best" to keep.
          </div>
        </div>
      )}
    </div>
  );
};

export default DeduplicationHelper;
