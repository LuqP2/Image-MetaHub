import React, { useState, useEffect } from 'react';
import { type IndexedImage } from '../types';
import { useContextMenu } from '../hooks/useContextMenu';
import { useImageStore } from '../store/useImageStore';
import { Copy, Folder, Download, ArrowUpDown, ArrowUp, ArrowDown, Info } from 'lucide-react';

interface ImageTableProps {
  images: IndexedImage[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
}

type SortField = 'filename' | 'model' | 'steps' | 'cfg' | 'size' | 'seed';
type SortDirection = 'asc' | 'desc' | null;

const ImageTable: React.FC<ImageTableProps> = ({ images, onImageClick, selectedImages }) => {
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

  const handleContextMenu = (image: IndexedImage, e: React.MouseEvent) => {
    if (selectedImages.size > 1) {
      return;
    }
    const directoryPath = directories.find(d => d.id === image.directoryId)?.path;
    showContextMenu(e, image, directoryPath);
  };

  // Function to apply sorting based on current field and direction
  const applySorting = (imagesToSort: IndexedImage[], field: SortField | null, direction: SortDirection) => {
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
  };

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
  }, [images, sortField, sortDirection]);

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-800 sticky top-0 z-10">
          <tr className="border-b border-gray-700">
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Preview</th>
            <th 
              className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors"
              onClick={() => handleSort('filename')}
            >
              <div className="flex items-center gap-1">
                Filename {getSortIcon('filename')}
              </div>
            </th>
            <th 
              className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors"
              onClick={() => handleSort('model')}
            >
              <div className="flex items-center gap-1">
                Model {getSortIcon('model')}
              </div>
            </th>
            <th 
              className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors"
              onClick={() => handleSort('steps')}
            >
              <div className="flex items-center gap-1">
                Steps {getSortIcon('steps')}
              </div>
            </th>
            <th 
              className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors"
              onClick={() => handleSort('cfg')}
            >
              <div className="flex items-center gap-1">
                CFG {getSortIcon('cfg')}
              </div>
            </th>
            <th 
              className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors"
              onClick={() => handleSort('size')}
            >
              <div className="flex items-center gap-1">
                Size {getSortIcon('size')}
              </div>
            </th>
            <th 
              className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors"
              onClick={() => handleSort('seed')}
            >
              <div className="flex items-center gap-1">
                Seed {getSortIcon('seed')}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedImages.map((image) => (
            <ImageTableRow
              key={image.id}
              image={image}
              onImageClick={onImageClick}
              isSelected={selectedImages.has(image.id)}
              onContextMenu={handleContextMenu}
            />
          ))}
        </tbody>
      </table>

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
}

const ImageTableRow: React.FC<ImageTableRowProps> = ({ image, onImageClick, isSelected, onContextMenu }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const setPreviewImage = useImageStore((state) => state.setPreviewImage);

  useEffect(() => {
    let isMounted = true;
    let currentUrl: string | null = null;
    const fileHandle = image.thumbnailHandle || image.handle;

    // Check if we can actually load this image
    const isElectron = typeof window !== 'undefined' && window.electronAPI;
    if (!isElectron && (!fileHandle || typeof fileHandle.getFile !== 'function')) {
      // In browser mode with invalid handles, don't try to load
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fileHandle.getFile().then(file => {
      if (isMounted) {
        currentUrl = URL.createObjectURL(file);
        setImageUrl(currentUrl);
        setIsLoading(false);
      }
    }).catch(error => {
      // Only log error if we're in Electron mode - browser mode failures are expected
      if (isElectron) {
        console.error('Failed to load image:', error);
      }
      if (image.thumbnailHandle && isMounted) {
        // Fallback to original image if thumbnail fails
        image.handle.getFile().then(file => {
          if (isMounted) {
            currentUrl = URL.createObjectURL(file);
            setImageUrl(currentUrl);
            setIsLoading(false);
          }
        }).catch(err => {
          if (isElectron) {
            console.error('Failed to load fallback image:', err);
          }
          setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [image.thumbnailHandle, image.handle]);

  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewImage(image);
  };

  return (
    <tr
      className={`border-b border-gray-700 hover:bg-gray-800/50 cursor-pointer transition-colors group ${
        isSelected ? 'bg-blue-900/30 border-blue-700' : ''
      }`}
      onClick={(e) => onImageClick(image, e)}
      onContextMenu={(e) => onContextMenu && onContextMenu(image, e)}
    >
      <td className="px-3 py-2">
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
      </td>
      <td className="px-3 py-2 text-gray-300 font-medium max-w-[200px] truncate" title={image.handle.name}>
        {image.handle.name}
      </td>
      <td className="px-3 py-2 text-gray-400 max-w-[150px] truncate" title={image.models?.[0] || 'Unknown'}>
        {image.models?.[0] || <span className="text-gray-600">Unknown</span>}
      </td>
      <td className="px-3 py-2 text-center">
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
      </td>
      <td className="px-3 py-2 text-center text-gray-400">
        {(() => {
          const cfg = image.cfgScale || (image.metadata as any)?.cfg_scale || (image.metadata as any)?.cfgScale || (image.metadata as any)?.normalizedMetadata?.cfg_scale;
          return cfg ? (
            <span className="font-mono text-sm">{typeof cfg === 'number' ? cfg.toFixed(1) : cfg}</span>
          ) : (
            <span className="text-gray-600 text-xs">—</span>
          );
        })()}
      </td>
      <td className="px-3 py-2 text-gray-400 font-mono text-xs">
        {(() => {
          const dims = image.dimensions || 
                      (image.metadata as any)?.dimensions ||
                      ((image.metadata as any)?.width && (image.metadata as any)?.height 
                        ? `${(image.metadata as any).width}×${(image.metadata as any).height}` 
                        : null);
          return dims || <span className="text-gray-600">—</span>;
        })()}
      </td>
      <td className="px-3 py-2 text-gray-500 font-mono text-xs max-w-[100px] truncate" title={(image.seed || (image.metadata as any)?.seed || (image.metadata as any)?.normalizedMetadata?.seed)?.toString()}>
        {(() => {
          const seed = image.seed || (image.metadata as any)?.seed || (image.metadata as any)?.normalizedMetadata?.seed;
          return seed || <span className="text-gray-600">—</span>;
        })()}
      </td>
    </tr>
  );
};

export default ImageTable;