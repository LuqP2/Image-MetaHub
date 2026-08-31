import React from 'react';
import { Copy, Fingerprint, LoaderCircle } from 'lucide-react';
import { type BaseMetadata, type IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import { getRelativeImagePath } from '../utils/imagePaths';
import {
  buildProvenanceViewModel,
  getProvenanceEvidenceLabel,
  serializeProvenanceSummary,
} from '../services/provenanceSummary';

interface ProvenanceSectionProps {
  image: IndexedImage;
  metadata?: BaseMetadata;
  rawMetadata?: unknown;
}

const EMPTY_DERIVED_IDS: string[] = [];

const getElectronFilePath = (image: IndexedImage): string | null => (
  (image.handle as FileSystemFileHandle & { _filePath?: string } | undefined)?._filePath || null
);

const formatDate = (timestamp: number | null): string | null => (
  timestamp ? new Date(timestamp).toLocaleString() : null
);

const formatBytes = (bytes: number | null): string | null => {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const EvidenceBadge: React.FC<{ evidence: 'embedded' | 'metahub-operation' | 'inferred' }> = ({ evidence }) => (
  <span className={
    evidence === 'inferred'
      ? 'rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300'
      : evidence === 'metahub-operation'
        ? 'rounded border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300'
        : 'rounded border border-blue-400/30 bg-blue-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300'
  }>
    {getProvenanceEvidenceLabel(evidence)}
  </span>
);

const ProvenanceSection: React.FC<ProvenanceSectionProps> = ({ image, metadata, rawMetadata }) => {
  const resolvedLineage = useImageStore(
    React.useCallback((state) => state.getResolvedLineage(image.id), [image.id])
  );
  const derivedIds = useImageStore(
    React.useCallback((state) => state.lineageDerivedIdsBySourceId[image.id] ?? EMPTY_DERIVED_IDS, [image.id])
  );
  const sourceImage = useImageStore(
    React.useCallback((state) => {
      const sourceImageId = state.lineageResolvedByImageId[image.id]?.sourceImageId;
      if (!sourceImageId) return null;
      return state.images.find((candidate) => candidate.id === sourceImageId)
        ?? state.filteredImages.find((candidate) => candidate.id === sourceImageId)
        ?? null;
    }, [image.id])
  );
  const images = useImageStore((state) => state.images);
  const filteredImages = useImageStore((state) => state.filteredImages);
  const directoryPath = useImageStore(
    React.useCallback(
      (state) => state.directories.find((directory) => directory.id === image.directoryId)?.path || null,
      [image.directoryId],
    )
  );
  const derivedImages = React.useMemo(
    () => derivedIds
      .map((id) => images.find((candidate) => candidate.id === id)
        ?? filteredImages.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is IndexedImage => Boolean(candidate)),
    [derivedIds, filteredImages, images],
  );
  const [sha256, setSha256] = React.useState<string | null>(null);
  const [hashError, setHashError] = React.useState<string | null>(null);
  const [isHashing, setIsHashing] = React.useState(false);
  const [copyStatus, setCopyStatus] = React.useState<string | null>(null);
  const filePath = getElectronFilePath(image);

  React.useEffect(() => {
    setSha256(null);
    setHashError(null);
    setIsHashing(false);
    setCopyStatus(null);
  }, [image.id]);

  const model = React.useMemo(() => buildProvenanceViewModel({
    image,
    metadata,
    rawMetadata,
    resolvedLineage,
    sourceImage,
    derivedImages,
  }), [derivedImages, image, metadata, rawMetadata, resolvedLineage, sourceImage]);

  const calculateFingerprint = async () => {
    if (!window.electronAPI?.hashFileSha256 || isHashing) return;
    setIsHashing(true);
    setHashError(null);
    let targetPath = filePath;
    if (!targetPath && directoryPath && window.electronAPI.joinPaths) {
      const joined = await window.electronAPI.joinPaths(directoryPath, getRelativeImagePath(image));
      targetPath = joined.success && joined.path ? joined.path : null;
    }
    if (!targetPath) {
      setIsHashing(false);
      setHashError('The file path is unavailable. Reopen the library and try again.');
      return;
    }
    const result = await window.electronAPI.hashFileSha256(targetPath);
    setIsHashing(false);
    if (result.success && result.sha256) {
      setSha256(result.sha256);
      return;
    }
    setHashError(result.error || 'Could not calculate the file fingerprint.');
  };

  const copySummary = async () => {
    const text = serializeProvenanceSummary(model, sha256);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('Copied');
    } catch {
      const result = await window.electronAPI?.copyTextToClipboard?.(text);
      setCopyStatus(result?.success ? 'Copied' : 'Copy failed');
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/40">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Provenance</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">What this file says, what Image MetaHub recorded, and what it inferred.</p>
        </div>
        <button
          type="button"
          onClick={() => void copySummary()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-gray-800 px-2 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          title="Copy provenance summary"
        >
          <Copy size={13} />
          {copyStatus || 'Copy summary'}
        </button>
      </div>

      <div className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
        <div><span className="font-medium text-gray-800 dark:text-gray-100">File:</span> {model.fileName}</div>
        <div className="break-all"><span className="font-medium text-gray-800 dark:text-gray-100">Library item:</span> {model.imageId}</div>
        {formatDate(model.lastModified) && <div><span className="font-medium text-gray-800 dark:text-gray-100">Last modified:</span> {formatDate(model.lastModified)}</div>}
        {formatBytes(model.fileSize) && <div><span className="font-medium text-gray-800 dark:text-gray-100">File size:</span> {formatBytes(model.fileSize)}</div>}
      </div>

      <div className="rounded-md border border-gray-200 bg-white/70 p-2 dark:border-gray-700/60 dark:bg-gray-950/30">
        <div className="flex flex-wrap items-center gap-2">
          <Fingerprint size={14} className="text-gray-500" />
          <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">SHA-256</span>
          {sha256 ? (
            <code className="min-w-0 flex-1 break-all text-[11px] text-gray-600 dark:text-gray-300">{sha256}</code>
          ) : (
            <span className="text-xs text-gray-500 dark:text-gray-400">{hashError || 'Not calculated'}</span>
          )}
          {window.electronAPI?.hashFileSha256 && !sha256 && (
            <button
              type="button"
              disabled={isHashing}
              onClick={() => void calculateFingerprint()}
              className="inline-flex items-center gap-1 rounded border border-gray-300 px-1.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {isHashing && <LoaderCircle size={12} className="animate-spin" />}
              {isHashing ? 'Calculating…' : 'Calculate'}
            </button>
          )}
        </div>
      </div>

      {model.generation.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Generation information</div>
          <div className="space-y-2">
            {model.generation.map((field) => (
              <div key={field.label} className="rounded-md border border-gray-200 bg-white/60 px-2 py-1.5 dark:border-gray-700/60 dark:bg-gray-950/20">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-gray-800 dark:text-gray-100">{field.label}</span>
                  <EvidenceBadge evidence={field.evidence} />
                </div>
                <div className="whitespace-pre-wrap break-words text-xs text-gray-600 dark:text-gray-300">{field.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {model.relationships.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Known relationships</div>
          {model.relationships.map((relationship, index) => (
            <div key={`${relationship.label}-${relationship.value}-${index}`} className="rounded-md border border-gray-200 bg-white/60 px-2 py-1.5 dark:border-gray-700/60 dark:bg-gray-950/20">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-gray-800 dark:text-gray-100">{relationship.label}: {relationship.value}</span>
                <EvidenceBadge evidence={relationship.evidence} />
              </div>
              {relationship.detail && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{relationship.detail}</div>}
            </div>
          ))}
        </div>
      )}

      {model.operation && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <span>Image MetaHub operation</span>
            <EvidenceBadge evidence="metahub-operation" />
          </div>
          <div className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
            {model.operation.tool && <div><span className="font-medium text-gray-800 dark:text-gray-100">Tool:</span> {model.operation.tool}</div>}
            {model.operation.sourceGenerator && <div><span className="font-medium text-gray-800 dark:text-gray-100">Original generator:</span> {model.operation.sourceGenerator}</div>}
            {model.operation.sourceImageId && <div className="break-all"><span className="font-medium text-gray-800 dark:text-gray-100">Editor source item:</span> {model.operation.sourceImageId}</div>}
            {model.operation.editedAt && <div><span className="font-medium text-gray-800 dark:text-gray-100">Edited at:</span> {model.operation.editedAt}</div>}
            {model.operation.recipeSummary && <div><span className="font-medium text-gray-800 dark:text-gray-100">Edit recipe:</span> {model.operation.recipeSummary}</div>}
          </div>
        </div>
      )}
    </section>
  );
};

export default ProvenanceSection;
