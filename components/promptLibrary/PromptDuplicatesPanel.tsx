import React, { useEffect, useRef, useState } from 'react';
import type { PromptLibraryItem } from '../../types';
import { findDuplicates } from '../../services/promptLibrary/duplicates';
import { itemTitle } from '../../services/promptLibrary/search';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { buttonClass } from './PromptVariables';
export default function PromptDuplicatesPanel({ item, items, onOpen }: {
  item: PromptLibraryItem;
  items: PromptLibraryItem[];
  onOpen: (item: PromptLibraryItem) => void;
}) {
  const [matches, setMatches] = useState<ReturnType<typeof findDuplicates>>([]);
  const [similar, setSimilar] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();
  useEffect(() => {
    const requestId = ++request.current;
    setError('');
    setMatches(findDuplicates(item, items, false));
    if(!similar || !canUseAdvancedPromptLibrary || typeof Worker === 'undefined') {
      if (similar && canUseAdvancedPromptLibrary && typeof Worker === 'undefined') setError('Similarity analysis unavailable. Exact duplicates still work.');
      return;
    }
    const worker = new Worker(new URL('../../services/workers/promptDuplicateWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if(e.data.requestId === request.current)
        setMatches(e.data.matches);
    };
    worker.onerror = () => setError('Similarity analysis unavailable. Exact duplicates still work.');
    worker.postMessage({ requestId, item, candidates: items, similar: true });
    return () => worker.terminate();
  }, [item, items, similar, canUseAdvancedPromptLibrary]);
  return <details open className="max-h-52 shrink-0 overflow-auto rounded-lg border border-gray-700 p-3 text-xs">
    <summary className="cursor-pointer">{"Duplicate text ("}{matches.length}{")"}</summary>
    <button className={buttonClass + ' mt-2'} onClick={() => {
      if(!canUseAdvancedPromptLibrary)
        showProModal('prompt_library_advanced');
      else
        setSimilar(!similar);
    }}>
      {similar ? 'Exact only' : 'Find similar (Pro)'}
    </button>
    {error && <p role="alert">
      {error}
    </p>}
    {matches.map((match) => {
      const candidate = items.find((p) => p.id === match.id); if (!candidate) return null; return <div key={match.id} className="mt-3 space-y-2 rounded border border-gray-700 p-2">
        <button className={buttonClass} onClick={() => onOpen(candidate)}>
          {itemTitle(candidate)}{" · "}{match.exact ? 'Same text' : `${Math.round(match.score * 100)}% similarity`}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words">
            {'text' in item ? item.text : `${item.positivePrompt}\n${item.negativePrompt}`}
          </pre>
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words">
            {'text' in candidate ? candidate.text : `${candidate.positivePrompt}\n${candidate.negativePrompt}`}
          </pre>
        </div>
      </div>;
    })}
    <p className="mt-2 text-gray-400">{"Same text can belong to different models or compositions. Nothing is merged automatically."}</p>
  </details>;
}
