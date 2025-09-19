
import React, { useEffect, useState } from 'react';
import { type IndexedImage } from '../types';
import { FileOperations } from '../services/fileOperations';
import DropdownMenu from './DropdownMenu';
import { copyImageToClipboard, showInExplorer, copyFilePathToClipboard } from '../utils/imageUtils';

interface ImageModalProps {
  image: IndexedImage;
  onClose: () => void;
  onImageDeleted?: (imageId: string) => void;
  onImageRenamed?: (imageId: string, newName: string) => void;
  currentIndex?: number;
  totalImages?: number;
  onNavigateNext?: () => void;
  onNavigatePrevious?: () => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ 
  image, 
  onClose, 
  onImageDeleted, 
  onImageRenamed,
  currentIndex = 0,
  totalImages = 0,
  onNavigateNext,
  onNavigatePrevious
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [showNavigationControls, setShowNavigationControls] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({x: 0, y: 0});

  // Function to export metadata as TXT
  const exportToTxt = () => {
    const filename = `${image.name.replace('.png', '')}_metadata.txt`;
    let content = `Image Metadata Export\n`;
    content += `========================\n`;
    content += `File: ${image.name}\n`;
    content += `Image ID: ${image.id}\n`;
    content += `Last Modified: ${new Date(image.lastModified).toLocaleString()}\n\n`;
    
    // Add models
    if (image.models && image.models.length > 0) {
      content += `Models Used:\n`;
      image.models.forEach((model, index) => {
        content += `  ${index + 1}. ${model}\n`;
      });
      content += `\n`;
    }
    
    // Add LoRAs
    if (image.loras && image.loras.length > 0) {
      content += `LoRAs Used:\n`;
      image.loras.forEach((lora, index) => {
        content += `  ${index + 1}. ${lora}\n`;
      });
      content += `\n`;
    }
    
    // Add scheduler
    if (image.scheduler) {
      content += `Scheduler: ${image.scheduler}\n\n`;
    }
    
    // Add board
    if (image.board) {
      content += `Board: ${image.board}\n\n`;
    }
    
    // Add all metadata
    content += `Complete Metadata:\n`;
    content += `==================\n`;
    Object.entries(image.metadata).forEach(([key, value]) => {
      content += `${key.replace(/_/g, ' ').toUpperCase()}:\n`;
      if (typeof value === 'object' && value !== null) {
        content += `${JSON.stringify(value, null, 2)}\n\n`;
      } else {
        content += `${String(value)}\n\n`;
      }
    });
    
    // Create and download file
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Function to export metadata as JSON
  const exportToJson = () => {
    const filename = `${image.name.replace('.png', '')}_metadata.json`;
    const exportData = {
      export_info: {
        exported_at: new Date().toISOString(),
        source_file: image.name,
        image_id: image.id,
        last_modified: new Date(image.lastModified).toISOString()
      },
      extracted_data: {
        models: image.models,
        loras: image.loras,
        scheduler: image.scheduler
      },
      raw_metadata: image.metadata,
      metadata_string: image.metadataString
    };
    
    // Create and download file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Function to handle file deletion
  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this image? This action cannot be undone.')) {
      return;
    }

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
  };

  // Function to handle file renaming
  const handleRename = () => {
    const currentName = image.name.replace('.png', '');
    setNewName(currentName);
    setIsRenaming(true);
  };

  const confirmRename = async () => {
    if (!newName.trim()) {
      alert('Filename cannot be empty');
      return;
    }

    const validation = FileOperations.validateFilename(newName);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

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
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setNewName('');
  };

  // Context menu actions
  const copyImage = async () => {
    const result = await copyImageToClipboard(image);
    if (!result.success) {
      alert('Failed to copy image: ' + result.error);
    }
    setShowContextMenu(false);
  };

  const showInFileExplorer = async () => {
    const result = await showInExplorer(image);
    if (!result.success) {
      alert('Failed to show in file explorer: ' + result.error);
    }
    setShowContextMenu(false);
  };

  const copyFilePath = async () => {
    const result = await copyFilePathToClipboard(image);
    if (!result.success) {
      alert('Failed to copy file path: ' + result.error);
    }
    setShowContextMenu(false);
  };

  const setAsWallpaper = () => {
    alert('Set as wallpaper not implemented yet');
    setShowContextMenu(false);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip keyboard shortcuts if user is typing in an input
      const activeElement = document.activeElement;
      const isInputFocused = activeElement && 
        (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || 
         (activeElement as HTMLElement).contentEditable === 'true');
      
      if (isInputFocused) {
        return;
      }

      if (event.key === 'Escape') {
        if (showContextMenu) {
          setShowContextMenu(false);
          return;
        }
        if (showExportDropdown) {
          setShowExportDropdown(false);
          return;
        }
        onClose();
      } else if (event.key === 'ArrowLeft' && onNavigatePrevious) {
        event.preventDefault();
        onNavigatePrevious();
      } else if (event.key === 'ArrowRight' && onNavigateNext) {
        event.preventDefault();
        onNavigateNext();
      } else if (event.key === 'Home' && totalImages > 1) {
        event.preventDefault();
        // Navigate to first image
        if (onNavigatePrevious) {
          for (let i = 0; i < currentIndex; i++) {
            onNavigatePrevious();
          }
        }
      } else if (event.key === 'End' && totalImages > 1) {
        event.preventDefault();
        // Navigate to last image
        if (onNavigateNext) {
          for (let i = currentIndex; i < totalImages - 1; i++) {
            onNavigateNext();
          }
        }
      } else if (event.key === 'Delete') {
        event.preventDefault();
        handleDelete();
      } else if (event.key === 'F2') {
        event.preventDefault();
        if (!isRenaming) {
          handleRename();
        }
      } else if (event.ctrlKey && event.key === 'c') {
        event.preventDefault();
        copyImage();
      } else if (event.ctrlKey && event.key === 'e') {
        event.preventDefault();
        showInFileExplorer();
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (showExportDropdown) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="export"]')) {
          setShowExportDropdown(false);
        }
      }
      if (showContextMenu) {
        const target = event.target as Element;
        if (!target.closest('[data-context-menu]')) {
          setShowContextMenu(false);
        }
      }
    };

    let isMounted = true;
    image.handle.getFile().then(file => {
      if(isMounted) {
          const url = URL.createObjectURL(file);
          setImageUrl(url);
      }
    });

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      isMounted = false;
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.handle, onClose, showExportDropdown, showContextMenu]);
  
  const renderMetadataValue = (value: any): string => {
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-6xl h-full max-h-[90vh] flex flex-col md:flex-row overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full md:w-2/3 h-1/2 md:h-full bg-black flex items-center justify-center p-4 relative"
             onMouseEnter={() => setShowNavigationControls(true)}
             onMouseLeave={() => setShowNavigationControls(false)}>
          {imageUrl ? (
            <img 
              src={imageUrl} 
              alt={image.name} 
              className="max-w-full max-h-full object-contain" 
              onContextMenu={(e) => {
                e.preventDefault();
                setShowContextMenu(true);
                setContextMenuPos({x: e.clientX, y: e.clientY});
              }}
            />
          ) : (
            <div className="w-full h-full animate-pulse bg-gray-700 rounded-md"></div>
          )}
          
          {/* Navigation Controls */}
          {showNavigationControls && totalImages > 1 && (
            <>
              {/* Previous Button */}
              {onNavigatePrevious && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigatePrevious();
                  }}
                  className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full p-3 transition-all duration-200 backdrop-blur-sm border border-white/20 hover:border-white/40 shadow-lg"
                  aria-label="Previous image"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              
              {/* Next Button */}
              {onNavigateNext && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateNext();
                  }}
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full p-3 transition-all duration-200 backdrop-blur-sm border border-white/20 hover:border-white/40 shadow-lg"
                  aria-label="Next image"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </>
          )}
          
          {/* Image Counter */}
          {totalImages > 1 && (
            <div className="absolute top-4 left-4 bg-black/60 text-white px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm border border-white/20">
              {currentIndex + 1} / {totalImages}
            </div>
          )}
        </div>
        <div className="w-full md:w-1/3 h-1/2 md:h-full p-6 overflow-y-auto">
          <div className="flex flex-col gap-3 mb-4">
            {/* File name with inline edit */}
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-100 break-words flex-1">{image.name}</h2>
              <button
                onClick={handleRename}
                disabled={isRenaming}
                className="text-gray-400 hover:text-orange-400 transition-colors duration-200 p-1"
                title="Rename file"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-gray-400 hover:text-red-400 transition-colors duration-200 p-1"
                title="Delete file (move to trash)"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-blue-400 font-mono break-all">{image.id}</p>
            
            {/* Export Dropdown */}
            <div className="relative" data-dropdown="export">
              <button
                onClick={() => setShowExportDropdown(!showExportDropdown)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors duration-200 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                Export metadata
                <svg className={`w-4 h-4 transition-transform duration-200 ${showExportDropdown ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              
              {showExportDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg z-10 min-w-full">
                  <button
                    onClick={() => {
                      exportToTxt();
                      setShowExportDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                    </svg>
                    Export as TXT
                  </button>
                  <button
                    onClick={() => {
                      exportToJson();
                      setShowExportDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                    </svg>
                    Export as JSON
                  </button>
                </div>
              )}
            </div>

            {/* Rename Dialog */}
            {isRenaming && (
              <div className="bg-gray-900 p-4 rounded-md border border-gray-700">
                <h4 className="text-white font-semibold mb-3">Rename File</h4>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Enter new filename (without extension)"
                  className="w-full px-3 py-2 bg-gray-800 text-white border border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
                  autoFocus
                />
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={confirmRename}
                    className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm font-medium transition-colors duration-200 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                  >
                    ✓ Confirm
                  </button>
                  <button
                    onClick={cancelRename}
                    className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded text-sm font-medium transition-colors duration-200 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                  >
                    ✗ Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <div className="space-y-3 text-sm">
            {Object.entries(image.metadata).map(([key, value]) => (
              <div key={key} className="bg-gray-900 p-3 rounded-md">
                <p className="font-semibold text-gray-400 capitalize">{key.replace(/_/g, ' ')}</p>
                <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-xs mt-1">{renderMetadataValue(value)}</pre>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Context Menu */}
      {showContextMenu && (
        <div 
          className="fixed bg-gray-700 border border-gray-600 rounded-md shadow-lg z-50 min-w-[200px]"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          onClick={(e) => e.stopPropagation()}
          data-context-menu
        >
          <button 
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200"
            onClick={copyImage}
          >
            Copy Image
          </button>
          <button 
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200"
            onClick={showInFileExplorer}
          >
            Show in File Explorer
          </button>
          <button 
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200"
            onClick={copyFilePath}
          >
            Copy File Path
          </button>
          <button 
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200"
            onClick={setAsWallpaper}
          >
            Set as Wallpaper
          </button>
        </div>
      )}
      
      <button
        className="absolute top-4 right-4 text-white text-3xl hover:text-gray-400 transition-colors"
        onClick={onClose}
      >
        &times;
      </button>
    </div>
  );
};

export default ImageModal;
