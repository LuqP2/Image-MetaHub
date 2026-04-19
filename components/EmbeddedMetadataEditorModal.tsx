import React, { useEffect, useMemo, useState } from 'react';
import { Clipboard, FilePenLine, RotateCcw, Save, X } from 'lucide-react';
import type { BaseMetadata, EmbeddedMetadataBackupStatus, IndexedImage } from '../types';
import {
  buildEmbeddedMetaHubPayload,
  formatEmbeddedMetaHubParameters,
} from '../utils/embeddedMetadataPayload';

interface EmbeddedMetadataEditorModalProps {
  isOpen: boolean;
  image: IndexedImage;
  directoryPath?: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

type Status = { type: 'success' | 'error'; message: string } | null;

const numberToInput = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '' : String(value);

const inputToNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const lorasToText = (loras: BaseMetadata['loras'] | undefined): string => {
  if (!Array.isArray(loras)) return '';
  return loras
    .map((lora) => typeof lora === 'string' ? lora : lora?.name || lora?.model_name || '')
    .filter(Boolean)
    .join(', ');
};

const textToLoras = (value: string): string[] | undefined => {
  const loras = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return loras.length > 0 ? loras : undefined;
};

export const EmbeddedMetadataEditorModal: React.FC<EmbeddedMetadataEditorModalProps> = ({
  isOpen,
  image,
  directoryPath,
  onClose,
  onSaved,
}) => {
  const normalizedMetadata = image.metadata?.normalizedMetadata as BaseMetadata | undefined;

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seed, setSeed] = useState('');
  const [steps, setSteps] = useState('');
  const [cfgScale, setCfgScale] = useState('');
  const [sampler, setSampler] = useState('');
  const [scheduler, setScheduler] = useState('');
  const [model, setModel] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [lorasText, setLorasText] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [backupStatus, setBackupStatus] = useState<EmbeddedMetadataBackupStatus | null>(null);

  const isSupportedFile = useMemo(() => /\.(png|jpe?g|webp)$/i.test(image.name), [image.name]);

  useEffect(() => {
    if (!isOpen) return;

    setPrompt(normalizedMetadata?.prompt || '');
    setNegativePrompt(normalizedMetadata?.negativePrompt || '');
    setSeed(numberToInput(normalizedMetadata?.seed));
    setSteps(numberToInput(normalizedMetadata?.steps));
    setCfgScale(numberToInput(normalizedMetadata?.cfg_scale ?? (normalizedMetadata as any)?.cfgScale));
    setSampler(normalizedMetadata?.sampler || '');
    setScheduler(normalizedMetadata?.scheduler || '');
    setModel(normalizedMetadata?.model || '');
    setWidth(numberToInput(normalizedMetadata?.width));
    setHeight(numberToInput(normalizedMetadata?.height));
    setLorasText(lorasToText(normalizedMetadata?.loras));
    setNotes((normalizedMetadata as any)?.notes || '');
    setStatus(null);
  }, [isOpen, normalizedMetadata]);

  const buildMetadata = (): Partial<BaseMetadata> & { cfgScale?: number } => ({
    prompt,
    negativePrompt,
    seed: inputToNumber(seed),
    steps: inputToNumber(steps),
    cfg_scale: inputToNumber(cfgScale),
    cfgScale: inputToNumber(cfgScale),
    sampler,
    scheduler,
    model,
    width: inputToNumber(width),
    height: inputToNumber(height),
    loras: textToLoras(lorasText),
    notes,
  } as Partial<BaseMetadata> & { cfgScale?: number });

  const getFilePath = async (): Promise<string> => {
    if (!window.electronAPI) {
      throw new Error('File metadata editing is only available in the desktop app.');
    }
    if (!directoryPath) {
      throw new Error('Source folder path is missing.');
    }
    const result = await window.electronAPI.joinPaths(directoryPath, image.name);
    if (!result.success || !result.path) {
      throw new Error(result.error || 'Failed to resolve image path.');
    }
    return result.path;
  };

  const refreshBackupStatus = async () => {
    if (!isOpen || !window.electronAPI || !directoryPath || !isSupportedFile) {
      setBackupStatus(null);
      return;
    }

    try {
      const filePath = await getFilePath();
      const result = await window.electronAPI.getEmbeddedMetadataBackupStatus({ filePath });
      setBackupStatus(result);
    } catch {
      setBackupStatus(null);
    }
  };

  useEffect(() => {
    void refreshBackupStatus();
  }, [isOpen, directoryPath, image.id, isSupportedFile]);

  const handleCopyMetadata = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildMetadata(), null, 2));
      setStatus({ type: 'success', message: 'Metadata copied. Paste fills this form only.' });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Failed to copy metadata.' });
    }
  };

  const handlePasteMetadata = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text) as Partial<BaseMetadata> & { cfgScale?: number };
      setPrompt(parsed.prompt || '');
      setNegativePrompt(parsed.negativePrompt || '');
      setSeed(numberToInput(parsed.seed));
      setSteps(numberToInput(parsed.steps));
      setCfgScale(numberToInput(parsed.cfg_scale ?? parsed.cfgScale));
      setSampler(parsed.sampler || '');
      setScheduler(parsed.scheduler || '');
      setModel(parsed.model || '');
      setWidth(numberToInput(parsed.width));
      setHeight(numberToInput(parsed.height));
      setLorasText(lorasToText(parsed.loras));
      setNotes((parsed as any).notes || '');
      setStatus({ type: 'success', message: 'Metadata pasted into the form. Nothing has been written yet.' });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Clipboard did not contain supported metadata JSON.' });
    }
  };

  const handleWrite = async () => {
    setIsWorking(true);
    setStatus(null);
    try {
      const filePath = await getFilePath();
      const metadata = buildMetadata();
      const result = await window.electronAPI!.writeEmbeddedMetadata({
        filePath,
        payload: buildEmbeddedMetaHubPayload(metadata),
        parameters: formatEmbeddedMetaHubParameters(metadata),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to write file metadata.');
      }

      setStatus({ type: 'success', message: 'File metadata written. Reparsed the image.' });
      await refreshBackupStatus();
      await onSaved();
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Failed to write file metadata.' });
    } finally {
      setIsWorking(false);
    }
  };

  const handleRestore = async () => {
    if (!window.confirm('Restore the original file from the internal backup? Current file metadata and pixels will be replaced with the backed-up file.')) {
      return;
    }

    setIsWorking(true);
    setStatus(null);
    try {
      const filePath = await getFilePath();
      const result = await window.electronAPI!.restoreEmbeddedMetadataBackup({ filePath });
      if (!result.success) {
        throw new Error(result.error || 'Failed to restore original file.');
      }
      setStatus({ type: 'success', message: 'Original file restored. Reparsed the image.' });
      await onSaved();
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Failed to restore original file.' });
    } finally {
      setIsWorking(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={(event) => event.stopPropagation()}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-4 p-4 border-b border-gray-800">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <FilePenLine size={20} className="text-amber-300" />
              Edit File Metadata
            </h2>
            <p className="mt-1 text-sm text-gray-400">Writes to the image file. A backup is saved before the first write.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" disabled={isWorking}>
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {!isSupportedFile && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              File metadata editing supports PNG, JPEG, and WebP.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="md:col-span-2 space-y-2">
              <span className="text-sm font-medium text-gray-400">Prompt</span>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-gray-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 outline-none text-sm min-h-[100px]" />
            </label>

            <label className="md:col-span-2 space-y-2">
              <span className="text-sm font-medium text-gray-400">Negative Prompt</span>
              <textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-gray-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 outline-none text-sm min-h-[80px]" />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-400">Seed</span>
              <input value={seed} onChange={(event) => setSeed(event.target.value)} type="number" className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-amber-500 outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-400">Steps</span>
              <input value={steps} onChange={(event) => setSteps(event.target.value)} type="number" className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-amber-500 outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-400">CFG Scale</span>
              <input value={cfgScale} onChange={(event) => setCfgScale(event.target.value)} type="number" step="0.1" className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-amber-500 outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-400">Model</span>
              <input value={model} onChange={(event) => setModel(event.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-amber-500 outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-400">Sampler</span>
              <input value={sampler} onChange={(event) => setSampler(event.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-amber-500 outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-400">Scheduler</span>
              <input value={scheduler} onChange={(event) => setScheduler(event.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-amber-500 outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-400">Width</span>
              <input value={width} onChange={(event) => setWidth(event.target.value)} type="number" className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-amber-500 outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-400">Height</span>
              <input value={height} onChange={(event) => setHeight(event.target.value)} type="number" className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-amber-500 outline-none" />
            </label>
            <label className="md:col-span-2 space-y-2">
              <span className="text-sm font-medium text-gray-400">LoRAs</span>
              <input value={lorasText} onChange={(event) => setLorasText(event.target.value)} placeholder="lora one, lora two" className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-amber-500 outline-none" />
            </label>
            <label className="md:col-span-2 space-y-2">
              <span className="text-sm font-medium text-gray-400">Notes</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-gray-200 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 outline-none text-sm min-h-[90px]" />
            </label>
          </div>

          {backupStatus?.hasBackup && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              Internal backup saved {backupStatus.createdAt ? new Date(backupStatus.createdAt).toLocaleString() : 'for this file'}.
            </div>
          )}

          {status && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${status.type === 'success' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`}>
              {status.message}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-800 flex flex-wrap justify-end gap-3 bg-gray-900 rounded-b-lg">
          <button onClick={handleCopyMetadata} disabled={isWorking} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors">
            <Clipboard size={16} /> Copy Metadata
          </button>
          <button onClick={handlePasteMetadata} disabled={isWorking} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors">
            <Clipboard size={16} /> Paste Metadata
          </button>
          {backupStatus?.hasBackup && (
            <button onClick={handleRestore} disabled={isWorking} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-amber-200 hover:text-white hover:bg-amber-900/40 transition-colors">
              <RotateCcw size={16} /> Restore Original File
            </button>
          )}
          <button onClick={onClose} disabled={isWorking} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors">
            Cancel
          </button>
          <button onClick={handleWrite} disabled={isWorking || !isSupportedFile} className="inline-flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <Save size={16} /> {isWorking ? 'Working...' : 'Write to File'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmbeddedMetadataEditorModal;
