import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Clock3, Layers3, Search } from 'lucide-react';
import type {
  IndexedImage,
  SearchFacetItem,
  SearchSessionResult,
  SearchSortMode,
  StructuredSearchResult,
} from '../types';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';

interface StructuredSearchResultsProps {
  result: StructuredSearchResult;
  imagesById: Map<string, IndexedImage>;
  selectedImages: Set<string>;
  sortMode: SearchSortMode;
  onSortModeChange: (mode: SearchSortMode) => void;
  onImageClick: (image: IndexedImage, event: React.MouseEvent, sessionImages: IndexedImage[]) => void;
  onAddQueryToken: (token: string) => void;
}

const formatSessionPeriod = (session: SearchSessionResult): string => {
  const start = new Date(session.startTime);
  const end = new Date(session.endTime);
  const date = start.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const startTime = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${startTime}–${endTime}`;
};

const quoteQueryValue = (value: string): string =>
  /[\s:"]/.test(value) ? `"${value.replace(/"/g, '')}"` : value;

const SearchThumbnail: React.FC<{
  image: IndexedImage;
  matched: boolean;
  selected: boolean;
  onClick: (event: React.MouseEvent) => void;
}> = ({ image, matched, selected, onClick }) => {
  const thumbnail = useResolvedThumbnail(image);
  const thumbnailUrl = thumbnail?.thumbnailStatus === 'ready'
    ? thumbnail.thumbnailUrl
    : image.thumbnailStatus === 'ready'
      ? image.thumbnailUrl
      : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(event) => {
        if (event.button === 1) onClick(event);
      }}
      className={`group relative aspect-square overflow-hidden rounded-xl border bg-gray-950 text-left transition ${
        selected
          ? 'border-blue-400 ring-2 ring-blue-500/50'
          : matched
            ? 'border-emerald-500/70 ring-1 ring-emerald-500/30'
            : 'border-gray-800 hover:border-gray-600'
      }`}
      title={image.name}
    >
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt={image.name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gray-900 text-gray-600">
          <Search className="h-6 w-6" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/90 to-transparent px-2 pb-1.5 pt-5 text-[10px] text-gray-200 opacity-0 transition group-hover:opacity-100">
        {image.name}
      </div>
      {matched && (
        <span className="absolute left-2 top-2 rounded-full border border-emerald-400/50 bg-emerald-950/90 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
          Match
        </span>
      )}
    </button>
  );
};

const FacetRow: React.FC<{
  label: string;
  field: string;
  items: SearchFacetItem[];
  onAddQueryToken: (token: string) => void;
  tokenForValue?: (value: string) => string;
}> = ({ label, field, items, onAddQueryToken, tokenForValue }) => {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</div>
      <div className="flex flex-wrap gap-2">
        {items.slice(0, 8).map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onAddQueryToken(tokenForValue?.(item.value) ?? `${field}:${quoteQueryValue(item.value)}`)}
            className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-300 transition hover:border-blue-500/60 hover:text-blue-200"
          >
            {item.value} <span className="text-gray-500">{item.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const StructuredSearchResults: React.FC<StructuredSearchResultsProps> = ({
  result,
  imagesById,
  selectedImages,
  sortMode,
  onSortModeChange,
  onImageClick,
  onAddQueryToken,
}) => {
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set());

  const toggleSession = (sessionId: string) => {
    setExpandedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const resolvedSessions = useMemo(
    () => result.sessions.map((session) => ({
      session,
      images: session.imageIds.map((imageId) => imagesById.get(imageId)).filter((image): image is IndexedImage => Boolean(image)),
      representative: imagesById.get(session.representativeImageId),
    })),
    [imagesById, result.sessions],
  );

  return (
    <div className="h-full overflow-y-auto px-5 py-5">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Sessions</h2>
            <p className="mt-1 text-sm text-gray-400">
              {result.matchedImageCount} matches across {result.sessions.length} sessions
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            Sort
            <select
              value={sortMode}
              onChange={(event) => onSortModeChange(event.target.value as SearchSortMode)}
              className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500/60"
            >
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="largest-batch">Largest Batch</option>
            </select>
          </label>
        </div>

        {result.warnings.length > 0 && (
          <div className="space-y-2 rounded-xl border border-amber-700/40 bg-amber-950/20 p-3">
            {result.warnings.map((warning, index) => (
              <div key={`${warning.code}-${warning.token}-${index}`} className="flex gap-2 text-sm text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        )}

        {(result.facets.models.length > 0 || result.facets.loras.length > 0 || result.facets.collections.length > 0 || result.facets.dates.length > 0) && (
          <section className="grid gap-4 rounded-2xl border border-gray-800 bg-gray-900/45 p-4 lg:grid-cols-2">
            <FacetRow label="Models" field="model" items={result.facets.models} onAddQueryToken={onAddQueryToken} />
            <FacetRow label="LoRAs" field="lora" items={result.facets.loras} onAddQueryToken={onAddQueryToken} />
            <FacetRow label="Collections" field="collection" items={result.facets.collections} onAddQueryToken={onAddQueryToken} />
            <FacetRow
              label="Dates"
              field="after"
              items={result.facets.dates}
              onAddQueryToken={onAddQueryToken}
              tokenForValue={(value) => `after:${value} before:${value}`}
            />
          </section>
        )}

        {result.sessions.length > 1 && (
          <section className="rounded-2xl border border-gray-800 bg-gray-900/35 p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Sessions</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {result.sessions.slice(0, 12).map((session) => (
                <button
                  key={`jump-${session.id}`}
                  type="button"
                  onClick={() => {
                    setExpandedSessionIds((current) => new Set(current).add(session.id));
                    document.getElementById(`search-${session.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="max-w-64 shrink-0 truncate rounded-full border border-gray-700 bg-gray-950/70 px-3 py-1.5 text-xs text-gray-300 hover:border-blue-500/60 hover:text-blue-200"
                  title={session.title}
                >
                  {session.title} <span className="text-gray-500">{session.matchedImageIds.length}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {resolvedSessions.length === 0 && (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-900/25 p-8 text-center">
            <Search className="mb-4 h-10 w-10 text-gray-600" />
            <h3 className="text-lg font-semibold text-gray-200">No matching sessions</h3>
            <p className="mt-2 max-w-md text-sm text-gray-500">
              Try a broader term, remove a field filter, or clear one of the active filters.
            </p>
          </div>
        )}

        {resolvedSessions.map(({ session, images, representative }) => {
          const expanded = expandedSessionIds.has(session.id);
          const matchedIds = new Set(session.matchedImageIds);
          const topReasons = session.imageResults[0]?.reasons.slice(0, 3) ?? [];
          const representativeThumbnail = representative ? (
            <SearchThumbnail
              image={representative}
              matched
              selected={selectedImages.has(representative.id)}
              onClick={(event) => onImageClick(representative, event, images)}
            />
          ) : null;

          return (
            <article id={`search-${session.id}`} key={session.id} className="scroll-mt-4 overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/55 shadow-lg shadow-black/10">
              <div className="grid gap-4 p-4 sm:grid-cols-[112px_minmax(0,1fr)_auto]">
                <div className="h-28 w-28">{representativeThumbnail}</div>
                <button type="button" onClick={() => toggleSession(session.id)} className="min-w-0 text-left">
                  <h3 className="truncate text-base font-semibold text-gray-100">{session.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-400">
                    <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatSessionPeriod(session)}</span>
                    {session.dominantModel && <span>{session.dominantModel}</span>}
                    <span className="font-medium text-emerald-300">{session.matchedImageIds.length} matches of {session.imageIds.length} images</span>
                  </div>
                  {topReasons.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {topReasons.map((reason, index) => (
                        <span key={`${reason.field}-${index}`} className="rounded-full border border-gray-700 bg-gray-950/70 px-2.5 py-1 text-[11px] text-gray-300">
                          <span className="text-gray-500">{reason.label}:</span> {reason.value}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSession(session.id)}
                  className="flex h-9 items-center gap-2 self-center rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-300 hover:border-gray-600 hover:text-white"
                >
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {expanded ? 'Collapse' : 'View batch'}
                </button>
              </div>

              {expanded && (
                <div className="border-t border-gray-800 bg-gray-950/35 p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
                    <Layers3 className="h-4 w-4" />
                    Full session context; matched images are highlighted
                  </div>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                    {images.map((image) => (
                      <SearchThumbnail
                        key={image.id}
                        image={image}
                        matched={matchedIds.has(image.id)}
                        selected={selectedImages.has(image.id)}
                        onClick={(event) => onImageClick(image, event, images)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default StructuredSearchResults;
