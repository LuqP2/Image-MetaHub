import React, { useState, useEffect, useCallback } from 'react';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { type IndexedImage } from '../types';
import { useContextMenu } from '../hooks/useContextMenu';
import { useImageStore } from '../store/useImageStore';
import { Copy, Folder, Download, ArrowUpDown, ArrowUp, ArrowDown, Info, Package, Play } from 'lucide-react';
import { useThumbnail } from '../hooks/useThumbnail';
import { useSettingsStore } from '../store/useSettingsStore';

interface ImageTableProps {
  images: IndexedImage[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
  onBatchExport: () => void;
}

type SortField = 'filename' | 'model' | 'steps' | 'cfg' | 'size' | 'seed';
type SortDirection = 'asc' | 'desc' | null;

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.avi'];

const isVideoFileName = (fileName: string, fileType?: string | null): boolean => {
  if (fileType && fileType.startsWith('video/')) {
    return true;
  }
  const lower = fileName.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

const ImageTable: React.FC<ImageTableProps> = ({ images, onImageClick, selectedImages, onBatchExport }) => {
  const directories = useImageStore((state) => state.directories);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [sortedImages, setSortedImages] = useState<IndexedImage[]>(images);

  const {
    contextMenu,
    showContextMenu,
    hideContextMenu,
    copyPrompt,
    copyNegativePrompt,
    copySeed,
    copyImage,
    copyModel,
    showInFolder,
    exportImage
  } = useContextMenu();

  const selectedCount = selectedImages.size;

  const handleContextMenu = (image: IndexedImage, e: React.MouseEvent) => {
    const directoryPath = directories.find(d => d.id === image.directoryId)?.path;
    showContextMenu(e, image, directoryPath);
  };

  const handleBatchExport = () => {
    hideContextMenu();
    onBatchExport();
  };

  // Function to apply sorting based on current field and direction
  // Memoized for performance - avoids recreating sort function on every render
  const applySorting = useCallback((imagesToSort: IndexedImage[], field: SortField | null, direction: SortDirection) => {
    if (!field || !direction) {
      return imagesToSort;
    }

    return [...imagesToSort].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (field) {
        case 'filename':
          aValue = a.handle.name.toLowerCase();
          bValue = b.handle.name.toLowerCase();
          break;
        case 'model':
          aValue = (a.models?.[0] || '').toLowerCase();
          bValue = (b.models?.[0] || '').toLowerCase();
          break;
        case 'steps': {
          const aSteps = a.steps || (a.metadata as any)?.steps || (a.metadata as any)?.normalizedMetadata?.steps || 0;
          const bSteps = b.steps || (b.metadata as any)?.steps || (b.metadata as any)?.normalizedMetadata?.steps || 0;
          aValue = aSteps;
          bValue = bSteps;
          break;
        }
        case 'cfg': {
          const aCfg = a.cfgScale || (a.metadata as any)?.cfg_scale || (a.metadata as any)?.cfgScale || (a.metadata as any)?.normalizedMetadata?.cfg_scale || 0;
          const bCfg = b.cfgScale || (b.metadata as any)?.cfg_scale || (b.metadata as any)?.cfgScale || (b.metadata as any)?.normalizedMetadata?.cfg_scale || 0;
          aValue = aCfg;
          bValue = bCfg;
          break;
        }
        case 'size': {
          const aDims = a.dimensions || (a.metadata as any)?.dimensions || '0x0';
          const bDims = b.dimensions || (b.metadata as any)?.dimensions || '0x0';
          const [aW, aH] = aDims.split('×').map(Number);
          const [bW, bH] = bDims.split('×').map(Number);
          aValue = aW * aH;
          bValue = bW * bH;
          break;
        }
        case 'seed': {
          const aSeed = a.seed || (a.metadata as any)?.seed || (a.metadata as any)?.normalizedMetadata?.seed || 0;
          const bSeed = b.seed || (b.metadata as any)?.seed || (b.metadata as any)?.normalizedMetadata?.seed || 0;
          aValue = aSeed;
          bValue = bSeed;
          break;
        }
        default:
          return 0;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return direction === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      } else {
        return direction === 'asc' ? (aValue as number) - (bValue as number) : (bValue as number) - (aValue as number);
      }
    });
  }, []); // No dependencies - pure function

  const handleSort = (field: SortField) => {
    let newDirection: SortDirection = 'asc';
    
    if (sortField === field) {
      if (sortDirection === 'asc') {
        newDirection = 'desc';
      } else if (sortDirection === 'desc') {
        newDirection = null;
        setSortField(null);
        setSortDirection(null);
        return;
      }
    }
    
    setSortField(field);
    setSortDirection(newDirection);
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    }
    if (sortDirection === 'asc') {
      return <ArrowUp className="w-3 h-3" />;
    }
    return <ArrowDown className="w-3 h-3" />;
  };

  // Update sorted images when images prop changes OR when sort settings change
  useEffect(() => {
    const sorted = applySorting(images, sortField, sortDirection);
    setSortedImages(sorted);
  }, [images, sortField, sortDirection, applySorting]);

  const columnWidths = [
    '96px', // Preview
    '280px', // Filename
    '220px', // Model
    '110px', // Steps
    '110px', // CFG
    '140px', // Size
    '160px', // Seed
  ];

  const gridTemplateColumns = columnWidths.join(' ');

  // Row renderer for virtualized list
  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const image = sortedImages[index];
    return (
      <div style={style}>
        <ImageTableRow
          image={image}
          onImageClick={onImageClick}
          isSelected={selectedImages.has(image.id)}
          onContextMenu={handleContextMenu}
          gridTemplateColumns={gridTemplateColumns}
        />
      </div>
    );
  };

  const ROW_HEIGHT = 64; // Height of each table row in pixels
  const HEADER_HEIGHT = 48; // Height of table header

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[1100px]">
          {/* Fixed Header */}
          <div className="bg-gray-800 border-b border-gray-700" style={{ height: HEADER_HEIGHT }}>
            <div className="grid text-sm" style={{ gridTemplateColumns }}>
              <div className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Preview</div>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('filename')}
              >
                <span className="flex items-center gap-1">Filename {getSortIcon('filename')}</span>
              </button>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('model')}
              >
                <span className="flex items-center gap-1">Model {getSortIcon('model')}</span>
              </button>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('steps')}
              >
                <span className="flex items-center gap-1">Steps {getSortIcon('steps')}</span>
              </button>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('cfg')}
              >
                <span className="flex items-center gap-1">CFG {getSortIcon('cfg')}</span>
              </button>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('size')}
              >
                <span className="flex items-center gap-1">Size {getSortIcon('size')}</span>
              </button>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('seed')}
              >
                <span className="flex items-center gap-1">Seed {getSortIcon('seed')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Virtualized Content */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-x-auto">
          <div className="min-w-[1100px] h-full">
            <AutoSizer>
              {({ height, width }: { height: number; width: number }) => (
                <List
                  height={height}
                  itemCount={sortedImages.length}
                  itemSize={ROW_HEIGHT}
                  width={width}
                  overscanCount={5}
                  itemKey={(index) => sortedImages[index]?.id ?? index}
                >
                  {Row}
                </List>
              )}
            </AutoSizer>
          </div>
        </div>
      </div>

      {contextMenu.visible && (
        <div
          className="fixed z-[60] bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[160px] context-menu-class"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={copyImage}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
          >
            <Copy className="w-4 h-4" />
            Copy to Clipboard
          </button>

          <div className="border-t border-gray-600 my-1"></div>

          <button
            onClick={copyPrompt}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.prompt}
          >
            <Copy className="w-4 h-4" />
            Copy Prompt
          </button>
          <button
            onClick={copyNegativePrompt}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.negativePrompt}
          >
            <Copy className="w-4 h-4" />
            Copy Negative Prompt
          </button>
          <button
            onClick={copySeed}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.seed}
          >
            <Copy className="w-4 h-4" />
            Copy Seed
          </button>
          <button
            onClick={copyModel}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.models?.[0]}
          >
            <Copy className="w-4 h-4" />
            Copy Model
          </button>

          <div className="border-t border-gray-600 my-1"></div>

          <button
            onClick={showInFolder}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
          >
            <Folder className="w-4 h-4" />
            Show in Folder
          </button>

            <button
              onClick={exportImage}
              className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export Image
            </button>
            {selectedCount > 1 && (
              <button
                onClick={handleBatchExport}
                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
              >
                <Package className="w-4 h-4" />
                Batch Export Selected ({selectedCount})
              </button>
            )}
          </div>
        )}
    </div>
  );
};

// Componente separado para cada linha da tabela com preview
interface ImageTableRowProps {
  image: IndexedImage;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  isSelected: boolean;
  onContextMenu?: (image: IndexedImage, event: React.MouseEvent) => void;
  gridTemplateColumns: string;
}

const ImageTableRow: React.FC<ImageTableRowProps> = React.memo(({ image, onImageClick, isSelected, onContextMenu, gridTemplateColumns }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const setPreviewImage = useImageStore((state) => state.setPreviewImage);
  const thumbnailsDisabled = useSettingsStore((state) => state.disableThumbnails);
  const isVideo = isVideoFileName(image.name, image.fileType);

  useThumbnail(image);

  useEffect(() => {
    if (thumbnailsDisabled) {
      setImageUrl(null);
      setIsLoading(false);
      return;
    }

    if (isVideo) {
      setImageUrl(null);
      setIsLoading(false);
      return;
    }

    if (image.thumbnailStatus === 'ready' && image.thumbnailUrl) {
      setImageUrl(image.thumbnailUrl);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    let fallbackUrl: string | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const fileHandle = image.thumbnailHandle || image.handle;
    const isElectron = typeof window !== 'undefined' && window.electronAPI;

    if (!fileHandle || typeof fileHandle.getFile !== 'function') {
      setIsLoading(false);
      return;
    }

    const loadFallback = async () => {
      setIsLoading(true);
      try {
        const file = await fileHandle.getFile();
        if (!isMounted) return;
        fallbackUrl = URL.createObjectURL(file);
        setImageUrl(fallbackUrl);
      } catch (error) {
        if (isElectron) {
          console.error('Failed to load image:', error);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fallbackTimer = setTimeout(() => {
      void loadFallback();
    }, 180);

    return () => {
      isMounted = false;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
      if (fallbackUrl) {
        URL.revokeObjectURL(fallbackUrl);
      }
    };
  }, [image.thumbnailHandle, image.handle, image.thumbnailStatus, image.thumbnailUrl, thumbnailsDisabled, isVideo]);

  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewImage(image);
  };

  return (
    <div
      className={`border-b border-gray-700 hover:bg-gray-800/50 cursor-pointer transition-colors group grid items-center ${
        isSelected ? 'bg-blue-900/30 border-blue-700' : ''
      }`}
      onClick={(e) => onImageClick(image, e)}
      onContextMenu={(e) => onContextMenu && onContextMenu(image, e)}
      style={{ height: '64px', gridTemplateColumns }}
    >
      <div className="px-3 py-2">
        <div className="relative w-12 h-12 bg-gray-700 rounded overflow-hidden flex items-center justify-center">
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
          ) : imageUrl ? (
            <>
              <img
                src={imageUrl}
                alt={image.handle.name}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {isVideo && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="rounded-full bg-black/50 p-1.5">
                    <Play className="h-4 w-4 text-white/90" />
                  </div>
                </div>
              )}
              <button
                onClick={handlePreviewClick}
                className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-500/70"
                title="Show details"
              >
                <Info className="h-4 w-4 text-white" />
              </button>
            </>
          ) : (
            <span className="text-xs text-gray-500">ERR</span>
          )}
        </div>
      </div>
      <div className="px-3 py-2 text-gray-300 font-medium truncate" title={image.handle.name}>
        {image.handle.name}
      </div>
      <div className="px-3 py-2 text-gray-400 truncate" title={image.models?.[0] || 'Unknown'}>
        {image.models?.[0] || <span className="text-gray-600">Unknown</span>}
      </div>
      <div className="px-3 py-2 text-center">
        {(() => {
          const steps = image.steps || (image.metadata as any)?.steps || (image.metadata as any)?.normalizedMetadata?.steps;
          return steps ? (
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              steps < 20 ? 'bg-green-900/40 text-green-300' :
              steps < 35 ? 'bg-blue-900/40 text-blue-300' :
              'bg-orange-900/40 text-orange-300'
            }`}>
              {steps}
            </span>
          ) : (
            <span className="text-gray-600 text-xs">—</span>
          );
        })()}
      </div>
      <div className="px-3 py-2 text-center text-gray-400">
        {(() => {
          const cfg = image.cfgScale || (image.metadata as any)?.cfg_scale || (image.metadata as any)?.cfgScale || (image.metadata as any)?.normalizedMetadata?.cfg_scale;
          return cfg ? (
            <span className="font-mono text-sm">{typeof cfg === 'number' ? cfg.toFixed(1) : cfg}</span>
          ) : (
            <span className="text-gray-600 text-xs">—</span>
          );
        })()}
      </div>
      <div className="px-3 py-2 text-gray-400 font-mono text-xs">
        {(() => {
          const dims = image.dimensions ||
                      (image.metadata as any)?.dimensions ||
                      ((image.metadata as any)?.width && (image.metadata as any)?.height 
                        ? `${(image.metadata as any).width}×${(image.metadata as any).height}` 
                        : null);
          return dims || <span className="text-gray-600">—</span>;
        })()}
      </div>
      <div className="px-3 py-2 text-gray-500 font-mono text-xs truncate" title={(image.seed || (image.metadata as any)?.seed || (image.metadata as any)?.normalizedMetadata?.seed)?.toString()}>
        {(() => {
          const seed = image.seed || (image.metadata as any)?.seed || (image.metadata as any)?.normalizedMetadata?.seed;
          return seed || <span className="text-gray-600">—</span>;
        })()}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for performance - only re-render if critical props changed
  return (
    prevProps.image.id === nextProps.image.id &&
    prevProps.image.thumbnailUrl === nextProps.image.thumbnailUrl &&
    prevProps.image.thumbnailStatus === nextProps.image.thumbnailStatus &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.gridTemplateColumns === nextProps.gridTemplateColumns
  );
});

export default ImageTable;
