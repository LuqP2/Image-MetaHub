import React, { useRef, useState } from 'react';
import { CheckCircle, Clipboard, Copy, Play } from 'lucide-react';
import type { IndexedImage, BaseMetadata } from '../../types';
import { hasVerifiedTelemetry } from '../../utils/telemetryDetection';
import { useResolvedThumbnail } from '../../hooks/useResolvedThumbnail';
import { composeSavedPromptInput, useSavePrompt } from '../../hooks/useSavePrompt';
import { getPersistedShadowMetadata } from '../../services/userDataPersistenceAdapter';
import { buttonClass } from '../promptLibrary/PromptVariables';
const formatValue = (value: unknown): string => value == null || value === '' ? 'Not found' : String(value);
const hasMetadataValue = (value: unknown) => value != null && value !== '';
const MetadataLine: React.FC<{
  label: string;
  value: unknown;
  onCopy?: (label: string, value: string) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLElement>, label: string, value: string) => void;
}> = ({ label, value, onCopy, onContextMenu }) => {
  const displayValue = formatValue(value);
  const canCopy = hasMetadataValue(value);

  return (
    <div
      className="group rounded-md border border-gray-800 bg-gray-950/60 px-3 py-2"
      onContextMenu={(event) => {
        if (canCopy) {
          onContextMenu?.(event, label, displayValue);
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
        {canCopy && onCopy && (
          <button
            type="button"
            onClick={() => onCopy(label, displayValue)}
            className="text-gray-500 opacity-0 transition-opacity hover:text-gray-100 group-hover:opacity-100 focus:opacity-100"
            title={`Copy ${label}`}
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-1 truncate font-mono text-xs text-gray-200" title={formatValue(value)}>
        {displayValue}
      </div>
    </div>
  );
};

const MetadataTextBlock: React.FC<{
  label: string;
  value: unknown;
  maxHeightClass: string;
  onCopy: (label: string, value: string) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>, label: string, value: string) => void;
}> = ({ label, value, maxHeightClass, onCopy, onContextMenu }) => {
  const displayValue = formatValue(value);
  const canCopy = hasMetadataValue(value);

  return (
    <div
      className="group rounded-lg border border-gray-800 bg-gray-950/80 p-3"
      onContextMenu={(event) => {
        if (canCopy) {
          onContextMenu(event, label, displayValue);
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
        {canCopy && (
          <button
            type="button"
            onClick={() => onCopy(label, displayValue)}
            className="text-gray-500 opacity-0 transition-opacity hover:text-gray-100 group-hover:opacity-100 focus:opacity-100"
            title={`Copy ${label}`}
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p data-prompt-text={canCopy ? true : undefined} className={`mt-2 overflow-y-auto whitespace-pre-wrap break-words text-xs text-gray-200 ${maxHeightClass}`}>
        {displayValue}
      </p>
    </div>
  );
};

type Props = {
 image: IndexedImage | null; metadata: BaseMetadata | null; directoryPath?: string;
 thumbnail: ReturnType<typeof useResolvedThumbnail>; currentPosition: number; normalizedNavigationImages: IndexedImage[];
 canNavigatePrevious: boolean; canNavigateNext: boolean; onNavigatePrevious?: () => void; onNavigateNext?: () => void;
 isGenerating: boolean; isCopying: boolean; generateFromMetadata: () => void;
 copyToComfyUI: (image: IndexedImage) => unknown; onOpenQueue: () => void;
 copyStatus: { success: boolean; message: string } | null; generateStatus: { success: boolean; message: string } | null;
 assetActionMessage: string; startImageFileDrag: (event: React.DragEvent<HTMLElement>, image: IndexedImage, path?: string) => void;
 showInspectorSelectionContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
 showInspectorFieldContextMenu: (event: React.MouseEvent<HTMLElement>, label: string, value: string) => void;
 copyInspectorValue: (label: string, value: string) => void; onUseComposer: (positive: string, negative: string) => void;
};
export default function WorkspaceImageInspector({ image, metadata, directoryPath, thumbnail, currentPosition, normalizedNavigationImages, canNavigatePrevious, canNavigateNext, onNavigatePrevious, onNavigateNext, isGenerating, isCopying, generateFromMetadata, copyToComfyUI, onOpenQueue, copyStatus, generateStatus, assetActionMessage, startImageFileDrag, showInspectorSelectionContextMenu, showInspectorFieldContextMenu, copyInspectorValue, onUseComposer }: Props) {
const savePrompt = useSavePrompt();
const currentImageId = useRef(image?.id);
currentImageId.current = image?.id;
const [saving, setSaving] = useState(false);
const [message, setMessage] = useState('');
return <section aria-label="Workspace Image Inspector" className="h-full overflow-y-auto p-4">
{image && <div className="flex flex-wrap gap-2">
<button className={buttonClass} disabled={saving} onClick={async () => {
 setSaving(true);
 try {
  await savePrompt(image, { directoryPath, readAuthoritativeShadow: true });
  setMessage('Prompt saved.');
 } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Save failed.'); }
 finally { setSaving(false); }
}}>Save prompt</button>
<button className={buttonClass} disabled={saving} onClick={async () => {
 setSaving(true);
 setMessage('');
 try {
  const shadow = await getPersistedShadowMetadata(image);
  if (currentImageId.current !== image.id) return;
  const effective = composeSavedPromptInput(image, shadow, directoryPath);
  onUseComposer(effective.positivePrompt, effective.negativePrompt);
 } catch (cause) {
  if (currentImageId.current === image.id) setMessage(cause instanceof Error ? cause.message : 'Could not open composer.');
 } finally { setSaving(false); }
}}>Use in composer</button>
</div>}
{message && <p role="status" className="mt-2 text-xs text-gray-400">{message}</p>}
          {!image ? (
            <div className="mt-6 rounded-lg border border-gray-800 bg-gray-950/80 p-4 text-sm text-gray-400">
              Select an image to send workflow data from Image MetaHub into ComfyUI.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={onNavigatePrevious}
                  disabled={!canNavigatePrevious}
                  className="rounded border border-gray-700 px-2 py-1 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-40"
                >
                  Previous
                </button>
                <div className="min-w-0 flex-1 truncate text-center text-xs text-gray-500">
                  {currentPosition} / {normalizedNavigationImages.length}
                </div>
                <button
                  onClick={onNavigateNext}
                  disabled={!canNavigateNext}
                  className="rounded border border-gray-700 px-2 py-1 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-40"
                >
                  Next
                </button>
              </div>

              <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
                {thumbnail?.thumbnailUrl ? (
                  <img
                    src={thumbnail.thumbnailUrl}
                    alt={image.name}
                    className="h-44 w-full cursor-grab object-contain bg-black active:cursor-grabbing"
                    draggable={Boolean(directoryPath && window.electronAPI?.startFileDrag)}
                    onDragStart={(event) => startImageFileDrag(event, image, directoryPath)}
                    title="Drag into ComfyUI"
                  />
                ) : (
                  <div className="flex h-44 items-center justify-center bg-black text-xs text-gray-600">No thumbnail</div>
                )}
                <div className="border-t border-gray-800 p-3">
                  <div className="truncate text-sm font-medium text-gray-100" title={image.name}>{image.name}</div>
                  {hasVerifiedTelemetry(image) && (
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-300 light:text-green-800">
                      <CheckCircle className="h-3.5 w-3.5" />
                      Verified
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={generateFromMetadata}
                  disabled={isGenerating || !metadata?.prompt}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-purple-500/40 bg-purple-500/15 px-3 py-2 text-xs font-semibold text-purple-100 light:text-purple-900 hover:bg-purple-500/25 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  Generate
                </button>
                <button
                  onClick={() => copyToComfyUI(image)}
                  disabled={isCopying || !metadata?.prompt}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                  Copy JSON
                </button>
                <button
                  onClick={onOpenQueue}
                  className="col-span-2 rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800"
                >
                  Open generation queue
                </button>
              </div>

              {(copyStatus || generateStatus) && (
                <div className={`rounded-md border px-3 py-2 text-xs ${
                  (copyStatus?.success || generateStatus?.success)
                    ? 'border-green-700/40 bg-green-500/10 text-green-200 light:text-green-800'
                    : 'border-red-700/40 bg-red-500/10 text-red-200 light:text-red-800'
                }`}>
                  {copyStatus?.message || generateStatus?.message}
                </div>
              )}

              {assetActionMessage && (
                <div className="rounded-md border border-blue-700/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-100 light:text-blue-900">
                  {assetActionMessage}
                </div>
              )}

              {metadata ? (
                  <div className="space-y-3" onContextMenu={showInspectorSelectionContextMenu}>
                  <div className="grid grid-cols-2 gap-2">
                    <MetadataLine label="Model" value={metadata.model} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine label="Seed" value={metadata.seed} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine label="Steps" value={metadata.steps} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine label="CFG" value={(metadata as any).cfgScale ?? metadata.cfg_scale} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine label="Sampler" value={metadata.sampler} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine label="Scheduler" value={metadata.scheduler} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine
                      label="Dimensions"
                      value={metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : undefined}
                      onCopy={copyInspectorValue}
                      onContextMenu={showInspectorFieldContextMenu}
                    />
                    <MetadataLine
                      label="LoRAs"
                      value={Array.isArray(metadata.loras) && metadata.loras.length > 0
                        ? metadata.loras.map((lora) => typeof lora === 'string' ? lora : lora.name || lora.model_name || '').filter(Boolean).join(', ')
                        : undefined}
                      onCopy={copyInspectorValue}
                      onContextMenu={showInspectorFieldContextMenu}
                    />
                  </div>

                  <MetadataTextBlock
                    label="Prompt"
                    value={metadata.prompt}
                    maxHeightClass="max-h-40"
                    onCopy={copyInspectorValue}
                    onContextMenu={showInspectorFieldContextMenu}
                  />

                  <MetadataTextBlock
                    label="Negative prompt"
                    value={metadata.negativePrompt}
                    maxHeightClass="max-h-32"
                    onCopy={copyInspectorValue}
                    onContextMenu={showInspectorFieldContextMenu}
                  />
                </div>
                ) : (
                  <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-4 text-sm text-gray-400">
                    No normalized metadata is available for this image.
                  </div>
              )}
            </div>
          )}

</section>;
}
