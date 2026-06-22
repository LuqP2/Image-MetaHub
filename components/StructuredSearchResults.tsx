import React from 'react';
import { AlertTriangle, Clock3, Images, Layers3 } from 'lucide-react';
import type {
  SearchFacetItem,
  SearchSessionResult,
  SearchSortMode,
  StructuredSearchResult,
} from '../types';

export type SearchPresentationMode = 'images' | 'sessions';

interface StructuredSearchResultsProps {
  result: StructuredSearchResult;
  mode: SearchPresentationMode;
  sortMode: SearchSortMode;
  activeSessionScope?: { sessionId: string; mode: 'matches' | 'full' } | null;
  onModeChange: (mode: SearchPresentationMode) => void;
  onSortModeChange: (mode: SearchSortMode) => void;
  onAddQueryToken: (token: string) => void;
  onOpenSession: (session: SearchSessionResult, mode: 'matches' | 'full') => void;
  onClearSessionScope: () => void;
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
            className="max-w-full truncate rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-300 transition hover:border-blue-500/60 hover:text-blue-200"
            title={`${item.value} (${item.count})`}
          >
            {item.value} <span className="text-gray-500">{item.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const SessionSummary: React.FC<{
  session: SearchSessionResult;
  onOpenSession: (session: SearchSessionResult, mode: 'matches' | 'full') => void;
}> = ({ session, onOpenSession }) => {
  const fields = Array.from(new Set(
    session.imageResults.flatMap((result) => result.reasons.map((reason) => reason.label)),
  )).slice(0, 3);

  return (
    <article className="rounded-2xl border border-gray-800 bg-gray-900/55 p-4 shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-gray-100" title={session.title}>
            {session.title}
          </h3>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-400">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" />
              {formatSessionPeriod(session)}
            </span>
            {session.dominantModel && <span>{session.dominantModel}</span>}
            <span className="font-medium text-emerald-300">
              {session.matchedImageIds.length} matches · {session.imageIds.length} images
            </span>
          </div>
          {fields.length > 0 && (
            <p className="mt-3 truncate text-xs text-gray-500">
              Matched in {fields.join(', ')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onOpenSession(session, 'matches')}
            className="inline-flex items-center gap-2 rounded-lg border border-blue-700/60 bg-blue-950/40 px-3 py-2 text-sm text-blue-200 hover:border-blue-500/70 hover:bg-blue-950/70"
          >
            <Images className="h-4 w-4" />
            Open matches
          </button>
          <button
            type="button"
            onClick={() => onOpenSession(session, 'full')}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:border-gray-600 hover:text-white"
          >
            <Layers3 className="h-4 w-4" />
            Open full session
          </button>
        </div>
      </div>
    </article>
  );
};

const StructuredSearchResults: React.FC<StructuredSearchResultsProps> = ({
  result,
  mode,
  sortMode,
  activeSessionScope,
  onModeChange,
  onSortModeChange,
  onAddQueryToken,
  onOpenSession,
  onClearSessionScope,
}) => (
  <div className={`border-b border-gray-800 bg-gray-950/35 px-5 py-4 ${mode === 'sessions' ? 'h-full overflow-y-auto' : 'max-h-[42vh] overflow-y-auto'}`}>
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-700 bg-gray-900 p-1">
            <button
              type="button"
              onClick={() => onModeChange('images')}
              className={`rounded-md px-3 py-1.5 text-sm transition ${mode === 'images' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Images
            </button>
            <button
              type="button"
              onClick={() => onModeChange('sessions')}
              className={`rounded-md px-3 py-1.5 text-sm transition ${mode === 'sessions' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Sessions
            </button>
          </div>
          <span className="text-sm text-gray-400">
            {result.matchedImageCount} matches across {result.sessions.length} sessions
          </span>
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
            {mode === 'sessions' && <option value="largest-batch">Largest Batch</option>}
          </select>
        </label>
      </div>

      {activeSessionScope && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-800/50 bg-blue-950/25 px-4 py-3">
          <span className="text-sm text-blue-100">
            Showing {activeSessionScope.mode === 'full' ? 'the full session' : 'session matches'} in the standard grid.
          </span>
          <button type="button" onClick={onClearSessionScope} className="text-sm font-medium text-blue-300 hover:text-blue-100">
            Back to search
          </button>
        </div>
      )}

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

      {mode === 'sessions' && (
        <div className="space-y-3">
          {result.sessions.map((session) => (
            <SessionSummary key={session.id} session={session} onOpenSession={onOpenSession} />
          ))}
          {result.sessions.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">
              No matching sessions.
            </div>
          )}
        </div>
      )}
    </div>
  </div>
);

export default StructuredSearchResults;
