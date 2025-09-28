import React, { useEffect, useState, useCallback } from 'react';
import { type IndexedImage, type BaseMetadata } from '../types';
import { FileOperations } from '../services/fileOperations';
import { copyImageToClipboard, showInExplorer, copyFilePathToClipboard } from '../utils/imageUtils';

interface ImageModalProps {
  image: IndexedImage | null;
  onClose: () => void;
  onImageDeleted?: (imageId: string) => void;
  onImageRenamed?: (imageId: string, newName: string) => void;
  currentIndex?: number;
  totalImages?: number;
  onNavigateNext?: () => void;
  onNavigatePrevious?: () => void;
  directoryPath?: string;
}

const MetadataRow: React.FC<{ label: string; value?: string | number | null; children?: React.ReactNode; onCopy?: () => void; }> = ({ label, value, children, onCopy }) => {
  if ((value === undefined || value === null) && !children) return null;

  return (
    <div className="bg-gray-900/70 p-3 rounded-lg relative group">
      <p className="font-semibold text-cyan-400/80 text-xs uppercase tracking-wider">{label}</p>
      {value != null && <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-sm mt-1">{String(value)}</pre>}
      {children}
      {onCopy && (
        <button onClick={onCopy} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-gray-700 hover:bg-gray-600 text-white p-1 rounded-md transition-opacity" title={`Copy ${label}`}>
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 011-1h6a1 1 0 110 2H8a1 1 0 01-1-1zM5 5a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2H5z" /></svg>
        </button>
      )}
    </div>
  );
};

const ImageModal: React.FC<ImageModalProps> = ({
  image,
  onClose,
  onImageDeleted,
  onImageRenamed,
  currentIndex = 0,
  totalImages = 0,
  onNavigateNext,
  onNavigatePrevious,
  directoryPath
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [showNavigationControls, setShowNavigationControls] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({x: 0, y: 0});
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Handle null image prop gracefully
  if (!image) {
    return null;
  }

  // --- Data Normalization ---
  const displayData: BaseMetadata = image.normalizedMetadata || {
    format: 'unknown',
    prompt: image.prompt || 'No prompt available',
    negativePrompt: image.negativePrompt,
    model: image.models?.[0] || 'Unknown',
    steps: image.steps,
    cfg_scale: image.cfgScale,
    seed: image.seed,
    scheduler: image.scheduler,
    sampler: image.scheduler,
    width: image.dimensions ? parseInt(image.dimensions.split('x')[0], 10) : 0,
    height: image.dimensions ? parseInt(image.dimensions.split('x')[1], 10) : 0,
    loras: image.loras,
  };

  // --- Actions ---
  const copyToClipboard = useCallback(async (text: string, type: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-[100] animate-pulse';
      notification.textContent = `${type} copied to clipboard!`;
      document.body.appendChild(notification);
      setTimeout(() => document.body.removeChild(notification), 2000);
    } catch (error) {
      console.error(`Error copying ${type}:`, error);
      alert(`Failed to copy ${type} to clipboard`);
    }
    setShowContextMenu(false);
  }, []);

  const exportToTxt = useCallback(() => {
    const filename = `${image.name.replace(/\.[^/.]+$/, "")}_metadata.txt`;
    let content = `📋 METADATA - ${image.name}\n========================================\n`;
    content += `Format: ${displayData.format || 'unknown'}\n`;
    content += `Model: ${displayData.model}\n`;
    if (displayData.steps) content += `Steps: ${displayData.steps}\n`;
    if (displayData.cfg_scale) content += `CFG Scale: ${displayData.cfg_scale}\n`;
    if (displayData.seed) content += `Seed: ${displayData.seed}\n`;
    if (displayData.sampler) content += `Sampler/Scheduler: ${displayData.sampler}\n`;
    if (displayData.width && displayData.height) content += `Dimensions: ${displayData.width}x${displayData.height}\n\n`;
    content += `Prompt:\n${displayData.prompt}\n\n`;
    if (displayData.negativePrompt) content += `Negative Prompt:\n${displayData.negativePrompt}\n\n`;
    if (displayData.loras && displayData.loras.length > 0) content += `LoRAs Used:\n${displayData.loras.join('\n')}\n\n`;
    content += `📄 RAW METADATA\n========================================\n${JSON.stringify(image.metadata, null, 2)}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setShowExportDropdown(false);
  }, [image.name, image.metadata, displayData]);

  const exportToJson = useCallback(() => {
    const filename = `${image.name.replace(/\.[^/.]+$/, "")}_metadata.json`;
    const exportData = { filename: image.name, lastModified: new Date(image.lastModified).toISOString(), normalized: displayData, raw: image.metadata };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setShowExportDropdown(false);
  }, [image.name, image.lastModified, image.metadata, displayData]);

  const handleDelete = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete this image? This action cannot be undone.')) return;
    setIsDeleting(true);
    try {
      const result = await FileOperations.deleteFile(image);
      if (result.success) {
        onImageDeleted?.(image.id);
        onClose();
      } else {
        alert(`Failed to delete file: ${result.error}`);
      }
    } catch (error) {
      alert(`Error deleting file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
  }, [image, onImageDeleted, onClose]);

  const handleRename = useCallback(() => {
    const currentName = image.name.replace(/\.[^/.]+$/, "");
    setNewName(currentName);
    setIsRenaming(true);
  }, [image.name]);

  const confirmRename = useCallback(async () => {
    if (!newName.trim()) return alert('Filename cannot be empty');
    const validation = FileOperations.validateFilename(newName);
    if (!validation.valid) return alert(validation.error);
    try {
      const result = await FileOperations.renameFile(image, newName);
      if (result.success) {
        onImageRenamed?.(image.id, newName + '.png');
        setIsRenaming(false);
        onClose();
      } else {
        alert(`Failed to rename file: ${result.error}`);
      }
    } catch (error) {
      alert(`Error renaming file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [image, newName, onImageRenamed, onClose]);

  const copyPrompt = useCallback(() => copyToClipboard(displayData.prompt, 'Prompt'), [copyToClipboard, displayData.prompt]);
  const copyNegativePrompt = useCallback(() => copyToClipboard(displayData.negativePrompt || '', 'Negative Prompt'), [copyToClipboard, displayData.negativePrompt]);
  const copySeed = useCallback(() => copyToClipboard(String(displayData.seed) || '', 'Seed'), [copyToClipboard, displayData.seed]);
  const copyAllMetadata = useCallback(() => copyToClipboard(JSON.stringify(image.metadata, null, 2), 'All Metadata'), [copyToClipboard, image.metadata]);

  const showInFileExplorer = useCallback(async () => {
    const fullPath = directoryPath ? `${directoryPath}/${image.name}` : image.name;
    const result = await showInExplorer(fullPath);
    if (!result.success) alert('Failed to show in file explorer: ' + result.error);
    setShowContextMenu(false);
  }, [directoryPath, image.name]);

  const copyImageAction = useCallback(async () => {
    const result = await copyImageToClipboard(image);
    if (!result.success) alert('Failed to copy image: ' + result.error);
    setShowContextMenu(false);
  }, [image]);

  const copyFilePathAction = useCallback(async () => {
    const result = await copyFilePathToClipboard(image);
    if (!result.success) alert('Failed to copy file path: ' + result.error);
    setShowContextMenu(false);
  }, [image]);

  const toggleFullscreen = useCallback(() => setIsFullscreen(fs => !fs), []);

  useEffect(() => {
    let isMounted = true;
    if (image) {
        image.handle.getFile().then(file => {
            if(isMounted) {
                const url = URL.createObjectURL(file);
                setImageUrl(url);
            }
        });
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) return;
      if (event.key === 'Escape') {
        if (isFullscreen) return setIsFullscreen(false);
        onClose();
      }
      if (event.key === 'ArrowLeft' && onNavigatePrevious) onNavigatePrevious();
      if (event.key === 'ArrowRight' && onNavigateNext) onNavigateNext();
      if (event.key === 'Delete') handleDelete();
      if (event.key === 'F2') handleRename();
      if (event.key.toLowerCase() === 'f') toggleFullscreen();
      if (event.ctrlKey && event.key === 'c') copyImageAction();
      if (event.ctrlKey && event.key === 'p') copyPrompt();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      isMounted = false;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [image, onClose, isFullscreen, onNavigateNext, onNavigatePrevious, handleDelete, handleRename, toggleFullscreen, copyImageAction, copyPrompt]);

  return (
    <div className={`fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm ${isFullscreen ? 'p-0' : ''}`} onClick={onClose}>
      <div className={`bg-gray-800/90 rounded-lg shadow-2xl w-full ${isFullscreen ? 'h-full max-w-none rounded-none' : 'max-w-6xl h-full max-h-[90vh]'} flex flex-col md:flex-row overflow-hidden transition-all duration-300`} onClick={(e) => e.stopPropagation()}>
        <div className={`w-full ${isFullscreen ? 'h-full' : 'md:w-2/3 h-1/2 md:h-full'} bg-black flex items-center justify-center relative`} onMouseEnter={() => setShowNavigationControls(true)} onMouseLeave={() => setShowNavigationControls(false)}>
          {imageUrl ? <img src={imageUrl} alt={image.name} className="max-w-full max-h-full object-contain cursor-pointer" onClick={toggleFullscreen} onContextMenu={(e) => { e.preventDefault(); setContextMenuPos({x: e.clientX, y: e.clientY}); setShowContextMenu(true); }}/> : <div className="w-full h-full animate-pulse bg-gray-700 rounded-md"></div>}
          {showNavigationControls && totalImages > 1 && (
            <>
              {onNavigatePrevious && <button onClick={(e) => {e.stopPropagation(); onNavigatePrevious();}} className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full p-3 transition-all duration-200 backdrop-blur-sm"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>}
              {onNavigateNext && <button onClick={(e) => {e.stopPropagation(); onNavigateNext();}} className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full p-3 transition-all duration-200 backdrop-blur-sm"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg></button>}
            </>
          )}
          {totalImages > 1 && <div className="absolute top-4 left-4 bg-black/60 text-white px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm">{currentIndex + 1} / {totalImages}</div>}
          <button onClick={(e) => {e.stopPropagation(); toggleFullscreen();}} className="absolute top-4 right-14 bg-black/60 hover:bg-black/80 text-white rounded-full p-3 transition-all duration-200 backdrop-blur-sm" title={isFullscreen ? "Exit Fullscreen (F)" : "Fullscreen (F)"}>{isFullscreen ? <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11 7v4m0 0h-4m4 0l-5-5M4 16v4m0 0h4m-4 0l5-5m11-7V4m0 0h-4m4 0l-5 5" /></svg> : <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11 7v4m0 0h-4m4 0l-5-5M4 16v4m0 0h4m-4 0l5-5m11-7V4m0 0h-4m4 0l-5 5" /></svg>}</button>
          <button onClick={onClose} className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-white rounded-full p-3 transition-all duration-200 backdrop-blur-sm" title="Close (Esc)">&times;</button>
        </div>
        <div className={`w-full ${isFullscreen ? 'hidden' : 'md:w-1/3 h-1/2 md:h-full'} p-6 overflow-y-auto bg-gray-800 text-gray-300 flex flex-col gap-4`}>
          <div>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-bold text-gray-100 break-words flex-1 pr-2">{image.name}</h2>
              <div className="flex items-center gap-1">
                <button onClick={handleRename} className="text-gray-400 hover:text-orange-400 p-1" title="Rename file (F2)"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg></button>
                <button onClick={handleDelete} className="text-gray-400 hover:text-red-400 p-1" title="Delete file (Del)"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg></button>
              </div>
            </div>
            <div className="relative mt-2" data-dropdown="export">
              <button onClick={() => setShowExportDropdown(!showExportDropdown)} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors duration-200 flex items-center gap-2">Export Metadata <svg className={`w-4 h-4 transition-transform duration-200 ${showExportDropdown ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg></button>
              {showExportDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg z-10 min-w-full">
                  <button onClick={exportToTxt} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2">Export as TXT</button>
                  <button onClick={exportToJson} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2">Export as JSON</button>
                </div>
              )}
            </div>
            {isRenaming && (
              <div className="bg-gray-900 p-4 rounded-md border border-gray-700 mt-4">
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full px-3 py-2 bg-gray-800 text-white border border-gray-600 rounded" onKeyDown={(e) => e.key === 'Enter' && confirmRename()} autoFocus />
                <div className="flex gap-2 mt-3"><button onClick={confirmRename} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm">Confirm</button><button onClick={() => setIsRenaming(false)} className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded text-sm">Cancel</button></div>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-gray-200 border-b border-gray-700 pb-2 mb-2">📋 Metadata</h3>
            <MetadataRow label="Format" value={displayData.format} onCopy={() => copyToClipboard(displayData.format || '', 'Format')} />
            <MetadataRow label="Prompt" value={displayData.prompt} onCopy={copyPrompt} />
            <MetadataRow label="Negative Prompt" value={displayData.negativePrompt} onCopy={copyNegativePrompt} />
            <MetadataRow label="Model" value={displayData.model} onCopy={() => copyToClipboard(displayData.model, 'Model')} />
            <div className="grid grid-cols-3 gap-2">
              <MetadataRow label="Steps" value={displayData.steps} onCopy={() => copyToClipboard(String(displayData.steps), 'Steps')} />
              <MetadataRow label="CFG Scale" value={displayData.cfg_scale} onCopy={() => copyToClipboard(String(displayData.cfg_scale), 'CFG Scale')} />
              <MetadataRow label="Seed" value={displayData.seed} onCopy={copySeed} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MetadataRow label="Dimensions" value={displayData.width && displayData.height ? `${displayData.width}x${displayData.height}` : undefined} onCopy={() => copyToClipboard(`${displayData.width}x${displayData.height}`, 'Dimensions')} />
              <MetadataRow label="Sampler" value={displayData.sampler || displayData.scheduler} onCopy={() => copyToClipboard(displayData.sampler || displayData.scheduler || '', 'Sampler')} />
            </div>
          </div>
          {(displayData.loras && displayData.loras.length > 0) && (
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-gray-200 border-b border-gray-700 pb-2 mb-2">🎨 Additional Details</h3>
              <MetadataRow label="LoRAs" onCopy={() => copyToClipboard(displayData.loras?.join(', ') || '', 'LoRAs')}><div className="text-gray-200 font-mono text-sm mt-1 space-y-1">{displayData.loras.map((lora, idx) => <div key={idx} className="break-words">{lora}</div>)}</div></MetadataRow>
            </div>
          )}
          <details className="bg-gray-900/50 rounded-lg"><summary className="cursor-pointer p-3 text-md font-semibold text-gray-300 hover:text-white">📄 Raw Metadata</summary><div className="p-3 border-t border-gray-700"><pre className="text-gray-400 whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(image.metadata, null, 2)}</pre></div></details>
        </div>
      </div>
      {showContextMenu && (
        <div className="fixed bg-gray-700 border border-gray-600 rounded-md shadow-lg z-[100] min-w-[200px]" style={{ left: contextMenuPos.x, top: contextMenuPos.y }} onClick={() => setShowContextMenu(false)}>
          <button onClick={copyImageAction} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 flex items-center gap-2">Copy Image (Ctrl+C)</button>
          <button onClick={copyPrompt} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 flex items-center gap-2">Copy Prompt (Ctrl+P)</button>
          <button onClick={copyNegativePrompt} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 flex items-center gap-2">Copy Negative Prompt</button>
          <button onClick={copySeed} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 flex items-center gap-2">Copy Seed</button>
          <div className="border-t border-gray-600 my-1"></div>
          <button onClick={copyFilePathAction} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 flex items-center gap-2">Copy File Path</button>
          <button onClick={showInFileExplorer} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 flex items-center gap-2">Show in Explorer</button>
          <div className="border-t border-gray-600 my-1"></div>
          <button onClick={copyAllMetadata} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 flex items-center gap-2">Copy All Metadata (JSON)</button>
        </div>
      )}
    </div>
  );
};

export default ImageModal;