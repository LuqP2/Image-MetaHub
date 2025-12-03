import React, { FC } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { ComparisonMetadataPanelProps } from '../types';

// Helper component for individual metadata fields
const MetadataField: FC<{
  label: string;
  value: any;
  onCopy?: () => void;
  multiline?: boolean;
}> = ({ label, value, onCopy, multiline }) => {
  if (!value && value !== 0) return null;

  return (
    <div className="bg-gray-900/50 p-2 rounded border border-gray-700/50">
      <div className="flex justify-between items-start">
        <p className="text-gray-400 text-xs uppercase tracking-wider">{label}</p>
        {onCopy && (
          <button
            onClick={onCopy}
            className="text-gray-400 hover:text-white transition-colors"
            title={`Copy ${label}`}
          >
            <Copy className="w-3 h-3" />
          </button>
        )}
      </div>
      <p className={`text-gray-200 text-sm mt-1 ${multiline ? 'whitespace-pre-wrap break-words' : ''}`}>
        {String(value)}
      </p>
    </div>
  );
};

const ComparisonMetadataPanel: FC<ComparisonMetadataPanelProps> = ({
  image,
  isExpanded,
  onToggleExpanded
}) => {
  const metadata = image.metadata?.normalizedMetadata;

  const copyToClipboard = (value: string, label: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(value).then(() => {
        // Show notification
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
        notification.textContent = `${label} copied to clipboard!`;
        document.body.appendChild(notification);
        setTimeout(() => {
          if (document.body.contains(notification)) {
            document.body.removeChild(notification);
          }
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
      });
    } else {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = value;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        textArea.remove();
        alert(`${label} copied to clipboard!`);
      } catch (err) {
        console.error('Failed to copy:', err);
        textArea.remove();
      }
    }
  };

  if (!metadata) {
    return (
      <div className="w-full md:w-1/2 p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
        <button
          onClick={onToggleExpanded}
          className="w-full p-3 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
        >
          <span className="font-semibold text-gray-200 truncate flex-1" title={image.name}>
            {image.name}
          </span>
          {isExpanded ? <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />}
        </button>
        {isExpanded && (
          <div className="p-3">
            <p className="text-gray-500 text-sm">No metadata available</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full md:w-1/2 bg-gray-800/50 rounded-lg border border-gray-700/50 overflow-hidden">
      {/* Toggle Button */}
      <button
        onClick={onToggleExpanded}
        className="w-full p-3 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors"
      >
        <span className="font-semibold text-gray-200 truncate flex-1 mr-2" title={image.name}>
          {image.name}
        </span>
        {isExpanded ? <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />}
      </button>

      {/* Metadata Content */}
      {isExpanded && (
        <div className="p-3 space-y-3 max-h-[300px] overflow-y-auto border-t border-gray-700/50">
          {/* Prompt */}
          {metadata.prompt && (
            <MetadataField
              label="Prompt"
              value={metadata.prompt}
              onCopy={() => copyToClipboard(metadata.prompt, 'Prompt')}
              multiline
            />
          )}

          {/* Negative Prompt */}
          {metadata.negativePrompt && (
            <MetadataField
              label="Negative Prompt"
              value={metadata.negativePrompt}
              onCopy={() => copyToClipboard(metadata.negativePrompt, 'Negative Prompt')}
              multiline
            />
          )}

          {/* Grid of smaller fields */}
          <div className="grid grid-cols-2 gap-2">
            {metadata.model && (
              <MetadataField
                label="Model"
                value={metadata.model}
                onCopy={() => copyToClipboard(metadata.model, 'Model')}
              />
            )}

            {(metadata.seed !== undefined && metadata.seed !== null) && (
              <MetadataField
                label="Seed"
                value={metadata.seed}
                onCopy={() => copyToClipboard(String(metadata.seed), 'Seed')}
              />
            )}

            {metadata.steps && (
              <MetadataField
                label="Steps"
                value={metadata.steps}
                onCopy={() => copyToClipboard(String(metadata.steps), 'Steps')}
              />
            )}

            {metadata.cfg_scale && (
              <MetadataField
                label="CFG Scale"
                value={metadata.cfg_scale}
                onCopy={() => copyToClipboard(String(metadata.cfg_scale), 'CFG Scale')}
              />
            )}

            {(metadata.sampler || metadata.scheduler) && (
              <MetadataField
                label="Sampler"
                value={metadata.sampler || metadata.scheduler}
                onCopy={() => copyToClipboard(metadata.sampler || metadata.scheduler, 'Sampler')}
              />
            )}

            {metadata.width && metadata.height && (
              <MetadataField
                label="Dimensions"
                value={`${metadata.width}x${metadata.height}`}
                onCopy={() => copyToClipboard(`${metadata.width}x${metadata.height}`, 'Dimensions')}
              />
            )}
          </div>

          {/* LoRAs if present */}
          {metadata.loras && metadata.loras.length > 0 && (
            <MetadataField
              label="LoRAs"
              value={metadata.loras.join(', ')}
              onCopy={() => copyToClipboard(metadata.loras.join(', '), 'LoRAs')}
              multiline
            />
          )}

          {/* Generator if present */}
          {metadata.generator && (
            <MetadataField
              label="Generator"
              value={metadata.generator}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(ComparisonMetadataPanel);
