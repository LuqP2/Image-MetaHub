import { Star, X } from 'lucide-react';
import type { ImageRating } from '../types';
import { getRatingChipClasses, getRatingLabel, RatingValueIcons } from './RatingStars';
const ratingOptions = [1, 2, 3, 4, 5] as const;
export default function LibraryRatingFilter({ selectedRatings, onChange, counts = new Map() }: { selectedRatings: ImageRating[]; onChange(value: ImageRating[]): void; counts?: Map<number, number> }) {
  const quickRatingCounts = counts;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Star className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-400 font-medium">Rating</span>
          {selectedRatings.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-900/70 px-2 py-0.5 text-xs text-gray-200">
              {selectedRatings.map((rating) => (
                <RatingValueIcons
                  key={`selected-rating-${rating}`}
                  value={rating}
                  size={10}
                  starClassName="fill-current"
                />
              ))}
            </span>
          )}
        </div>
        {selectedRatings.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-gray-400 hover:text-red-400 cursor-pointer"
            title="Clear rating filters"
            aria-label="Clear rating filters"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
            selectedRatings.length === 0
              ? 'border-blue-600/60 bg-blue-900/40 text-blue-200'
              : 'border-gray-700 bg-gray-800/70 text-gray-300 hover:border-gray-600 hover:text-gray-100'
          }`}
        >
          All
        </button>
        {ratingOptions.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(selectedRatings.includes(value) ? selectedRatings.filter(rating => rating !== value) : [...selectedRatings, value])}
            className={`inline-flex h-7 items-center justify-center rounded-md border px-1.5 transition-colors ${getRatingChipClasses(value, selectedRatings.includes(value))}`}
            title={`${quickRatingCounts.get(value) ?? 0} images rated ${getRatingLabel(value)}`}
            aria-label={`Toggle ${getRatingLabel(value)} filter`}
          >
            <RatingValueIcons value={value} size={11} starClassName="fill-current" />
          </button>
        ))}
      </div>
    </div>
  );
}
