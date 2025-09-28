
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
  directoryPath?: string;
}

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
    // console.log('directoryPath:', directoryPath);
    // console.log('image.name:', image.name);
    const fullPath = directoryPath ? `${directoryPath}/${image.name}` : image.name;
    // console.log('fullPath:', fullPath);

    const result = await showInExplorer(fullPath);
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

  // Function to toggle fullscreen mode
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Function to copy current information based on context
  const copyCurrentInfo = async () => {
    try {
      // Try to copy image first
      const imageResult = await copyImageToClipboard(image);
      if (imageResult.success) {
        // Show feedback
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50';
        notification.textContent = 'Image copied to clipboard!';
        document.body.appendChild(notification);
        setTimeout(() => document.body.removeChild(notification), 2000);
        return;
      }

      // If image copy fails, try to copy file path
      const pathResult = await copyFilePathToClipboard(image);
      if (pathResult.success) {
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50';
        notification.textContent = 'File path copied to clipboard!';
        document.body.appendChild(notification);
        setTimeout(() => document.body.removeChild(notification), 2000);
        return;
      }

      // If both fail, show error
      alert('Failed to copy information to clipboard');
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      alert('Failed to copy to clipboard');
    }
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

      // Ctrl+C to copy current metadata field or image info
      if (event.ctrlKey && event.key === 'c') {
        event.preventDefault();
        copyCurrentInfo();
        return;
      }

      // Ctrl+V to paste (if applicable)
      if (event.ctrlKey && event.key === 'v') {
        event.preventDefault();
        // Could implement paste functionality if needed
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
        if (isFullscreen) {
          setIsFullscreen(false);
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
      }

      // Ctrl+C to copy image
      if (event.ctrlKey && event.key === 'c' && !event.shiftKey) {
        event.preventDefault();
        copyImage();
        return;
      }

      // Ctrl+Shift+C to copy metadata
      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        event.preventDefault();
        copyMetadata();
        return;
      }

      // Ctrl+P to copy prompt
      if (event.ctrlKey && event.key === 'p') {
        event.preventDefault();
        copyPrompt();
        return;
      }

      // Ctrl+E to show in explorer
      if (event.ctrlKey && event.key === 'e') {
        event.preventDefault();
        showInFileExplorer();
        return;
      }

      // Ctrl+F to copy file path
      if (event.ctrlKey && event.key === 'f') {
        event.preventDefault();
        copyFilePath();
        return;
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

  // Function to copy metadata to clipboard
  const copyMetadata = async () => {
    try {
      const metadataText = Object.entries(image.metadata)
        .map(([key, value]) => `${key}: ${renderMetadataValue(value)}`)
        .join('\n');

      // Ensure document has focus before clipboard operation
      if (document.hidden || !document.hasFocus()) {
        // Try to focus the document
        window.focus();
        // Small delay to ensure focus is established
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      await navigator.clipboard.writeText(metadataText);

      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50';
      notification.textContent = 'Metadata copied to clipboard!';
      document.body.appendChild(notification);
      setTimeout(() => document.body.removeChild(notification), 2000);
    } catch (error) {
      console.error('Error copying metadata:', error);
      alert('Failed to copy metadata to clipboard');
    }
    setShowContextMenu(false);
  };

  // Function to copy prompt specifically
  const copyPrompt = async () => {
    try {
      // Try different possible prompt locations in InvokeAI metadata
      let prompt = '';

      // Direct prompt field
      if (image.metadata?.prompt) {
        if (typeof image.metadata.prompt === 'string') {
          prompt = image.metadata.prompt;
        } else if (Array.isArray(image.metadata.prompt)) {
          // Handle array of prompts (some InvokeAI versions)
          prompt = image.metadata.prompt
            .map(p => typeof p === 'string' ? p : (p as any)?.prompt || '')
            .filter(p => p.trim())
            .join(' ');
        } else if (typeof image.metadata.prompt === 'object' && (image.metadata.prompt as any).prompt) {
          // Handle object with prompt property
          prompt = (image.metadata.prompt as any).prompt;
        }
      }

      // Alternative prompt fields (case variations)
      if (!prompt) {
        const possiblePromptFields = ['Prompt', 'prompt_text', 'positive_prompt', 'text_prompt'];
        for (const field of possiblePromptFields) {
          if (image.metadata?.[field]) {
            if (typeof image.metadata[field] === 'string') {
              prompt = image.metadata[field];
              break;
            }
          }
        }
      }

      // Clean up the prompt (remove extra whitespace)
      prompt = prompt.trim();

      if (prompt) {
        // Ensure document has focus before clipboard operation
        if (document.hidden || !document.hasFocus()) {
          // Try to focus the document
          window.focus();
          // Small delay to ensure focus is established
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        await navigator.clipboard.writeText(prompt);

        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50';
        notification.textContent = 'Prompt copied to clipboard!';
        document.body.appendChild(notification);
        setTimeout(() => document.body.removeChild(notification), 2000);
      } else {
        alert('No prompt found in image metadata');
      }
    } catch (error) {
      console.error('Error copying prompt:', error);
      alert('Failed to copy prompt to clipboard');
    }
    setShowContextMenu(false);
  };

  const renderMetadataValue = (value: any): string => {
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  return (
    <div
      className={`fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm ${isFullscreen ? 'p-0' : ''}`}
      onClick={onClose}
    >
      <div
        className={`bg-gray-800 rounded-lg shadow-2xl w-full ${isFullscreen ? 'h-full max-w-none rounded-none' : 'max-w-6xl h-full max-h-[90vh]'} flex flex-col md:flex-row overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`w-full ${isFullscreen ? 'h-full' : 'md:w-2/3 h-1/2 md:h-full'} bg-black flex items-center justify-center ${isFullscreen ? 'p-0' : 'p-4'} relative`}
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

          {/* Fullscreen Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            className={`absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-white rounded-full p-3 transition-all duration-200 backdrop-blur-sm border border-white/20 hover:border-white/40 shadow-lg ${showNavigationControls ? 'opacity-100' : 'opacity-0'} hover:opacity-100`}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={isFullscreen ? "Exit fullscreen (ESC)" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.5 3.5M15 9h4.5M15 9V4.5M15 9l5.5-5.5M9 15v4.5M9 15H4.5M9 15l-5.5 5.5M15 15h4.5M15 15v4.5m0-4.5l5.5 5.5" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 3l-6 6m0 0V4m0 5h5M3 21l6-6m0 0v5m0-5H4" />
              </svg>
            )}
          </button>
        </div>
        <div className={`w-full ${isFullscreen ? 'hidden' : 'md:w-1/3 h-1/2 md:h-full'} p-6 overflow-y-auto`}>
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
            {/* Structured Metadata Fields */}
            {image.models && image.models.length > 0 && (
              <div className="bg-gray-900 p-3 rounded-md">
                <p className="font-semibold text-gray-400">Models</p>
                <div className="text-gray-200 font-mono text-xs mt-1">
                  {image.models.map((model, idx) => (
                    <div key={idx} className="break-words">{model}</div>
                  ))}
                </div>
              </div>
            )}

            {image.loras && image.loras.length > 0 && (
              <div className="bg-gray-900 p-3 rounded-md">
                <p className="font-semibold text-gray-400">LoRAs</p>
                <div className="text-gray-200 font-mono text-xs mt-1">
                  {image.loras.map((lora, idx) => (
                    <div key={idx} className="break-words">{lora}</div>
                  ))}
                </div>
              </div>
            )}

            {image.scheduler && image.scheduler !== 'Unknown' && (
              <div className="bg-gray-900 p-3 rounded-md">
                <p className="font-semibold text-gray-400">Scheduler</p>
                <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-xs mt-1">{image.scheduler}</pre>
              </div>
            )}

            {image.prompt && (
              <div className="bg-gray-900 p-3 rounded-md">
                <p className="font-semibold text-gray-400">Prompt</p>
                <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-xs mt-1">{image.prompt}</pre>
              </div>
            )}

            {image.cfgScale !== undefined && (
              <div className="bg-gray-900 p-3 rounded-md">
                <p className="font-semibold text-gray-400">CFG Scale</p>
                <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-xs mt-1">{image.cfgScale}</pre>
              </div>
            )}

            {image.steps !== undefined && (
              <div className="bg-gray-900 p-3 rounded-md">
                <p className="font-semibold text-gray-400">Steps</p>
                <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-xs mt-1">{image.steps}</pre>
              </div>
            )}

            {image.seed !== undefined && (
              <div className="bg-gray-900 p-3 rounded-md">
                <p className="font-semibold text-gray-400">Seed</p>
                <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-xs mt-1">{image.seed}</pre>
              </div>
            )}

            {image.dimensions && (
              <div className="bg-gray-900 p-3 rounded-md">
                <p className="font-semibold text-gray-400">Dimensions</p>
                <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-xs mt-1">{image.dimensions}</pre>
              </div>
            )}

            {/* Raw metadata fields - exclude internal/raw data that shouldn't be displayed */}
            {Object.entries(image.metadata).filter(([key, value]) => {
              // Skip fields that are already displayed as structured data
              const structuredFields = ['workflow', 'prompt', 'normalizedMetadata'];
              if (structuredFields.includes(key)) return false;

              // Skip empty/null values
              if (value === null || value === undefined || value === '') return false;

              // Skip empty objects/arrays
              if (typeof value === 'object' && (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0)) return false;

              return true;
            }).map(([key, value]) => (
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
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2"
            onClick={copyImage}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
            </svg>
            Copy Image
          </button>
          <button
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2"
            onClick={copyPrompt}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Copy Prompt
          </button>
          <button
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2"
            onClick={copyMetadata}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
            </svg>
            Copy All Metadata
          </button>
          <div className="border-t border-gray-600 my-1"></div>
          <button
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2"
            onClick={copyFilePath}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
            </svg>
            Copy File Path
          </button>
          <button
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2"
            onClick={showInFileExplorer}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h4a2 2 0 012 2v2a2 2 0 01-2 2h-4a2 2 0 01-2-2V6zm-5 8a2 2 0 012-2h4a2 2 0 012 2v2a2 2 0 01-2 2H9a2 2 0 01-2-2v-2z" clipRule="evenodd" />
            </svg>
            Show in File Explorer
          </button>
          <button
            className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2"
            onClick={setAsWallpaper}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
            </svg>
            Set as Wallpaper
          </button>
        </div>
      )}

      <button
        className={`absolute top-4 right-4 text-white text-3xl hover:text-gray-400 transition-colors ${isFullscreen ? 'opacity-100' : showNavigationControls ? 'opacity-100' : 'opacity-0'} hover:opacity-100`}
        onClick={onClose}
      >
        &times;
      </button>
    </div>
  );
};

export default ImageModal;
