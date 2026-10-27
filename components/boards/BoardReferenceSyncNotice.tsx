import { flushReferenceRemaps, useBoardReferenceSync } from '../../services/boards/referenceSync';
export default function BoardReferenceSyncNotice() {
  const error = useBoardReferenceSync(state => state.error);
  if (!error) return null;
  return <div role="alert" className="fixed bottom-4 right-4 z-[100] max-w-lg rounded border border-amber-500/50 bg-gray-900 p-4 text-sm text-amber-100 shadow-lg">
    {error}<button className="ml-3 underline" onClick={() => { void flushReferenceRemaps().catch(() => {}); }}>Retry</button>
  </div>;
}
