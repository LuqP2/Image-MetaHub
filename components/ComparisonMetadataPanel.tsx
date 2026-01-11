import React, { FC, useMemo } from 'react';
import { ChevronDown, ChevronRight, Copy, AlertTriangle } from 'lucide-react';
import { ComparisonMetadataPanelProps, BaseMetadata } from '../types';
import { compareField, formatFieldValue, diffText, DiffToken } from '../utils/metadataComparison';

// Helper component for individual metadata fields
const MetadataField: FC<{
  label: string;
  value: any;
  onCopy?: () => void;
  multiline?: boolean;
  otherValue?: any;
  isDiffMode?: boolean;
  field?: string;
}> = ({ label, value, onCopy, multiline, otherValue, isDiffMode, field }) => {
  // Check if value exists
  const hasValue = value !== undefined && value !== null && value !== '';
  const hasOtherValue = otherValue !== undefined && otherValue !== null && otherValue !== '';

  if (!hasValue) {
    // In diff mode, show missing fields if the other image has them
    if (isDiffMode && hasOtherValue) {
      return (
        <div className="bg-gray-800/40 p-2 rounded border border-gray-600/50">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-1">
              <p className="text-gray-400 text-xs uppercase tracking-wider">{label}</p>
              <AlertTriangle className="w-3 h-3 text-gray-500" />
            </div>
          </div>
          <p className="text-gray-400 text-sm mt-1 italic">Missing</p>
        </div>
      );
    }
    return null;
  }

  // Check if this field is different from the other image
  const isDifferent = isDiffMode &&
    hasOtherValue &&
    !compareField(field || label.toLowerCase(), value, otherValue);

  // For text prompts, use word-level diff
  const isPromptField = field === 'prompt' || field === 'negativePrompt';
  const shouldShowWordDiff = isDiffMode && isDifferent && isPromptField && typeof value === 'string' && typeof otherValue === 'string';

  // Apply highlighting based on difference
  const highlightClass = isDifferent
    ? 'bg-blue-900/20 border-blue-700/40'
    : 'bg-gray-900/50 border-gray-700/50';

  // Format the value for display
  const displayValue = field ? formatFieldValue(field, value) : String(value);

  // Render word-level diff for prompts
  const renderContent = () => {
    if (shouldShowWordDiff) {
      const stringValue = String(value);
      const stringOtherValue = String(otherValue);
      const diff = diffText(stringValue, stringOtherValue);

      return (
        <div className="text-gray-200 text-sm mt-1 whitespace-pre-wrap break-words">
          {diff.tokensA.map((token, idx) => {
            if (token.status === 'removed') {
              return (
                <span key={idx} className="bg-blue-500/30 px-0.5 rounded">
                  {token.text}
                </span>
              );
            }
            return <span key={idx}>{token.text}</span>;
          })}
        </div>
      );
    }

    return (
      <p className={`text-gray-200 text-sm mt-1 break-words ${multiline ? 'whitespace-pre-wrap' : ''}`}>
        {displayValue}
      </p>
    );
  };

  return (
    <div className={`p-2 rounded border ${highlightClass}`}>
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
      {renderContent()}
    </div>
  );
};

const ComparisonMetadataPanel: FC<ComparisonMetadataPanelProps> = ({
  image,
  isExpanded,
  onToggleExpanded,
  viewMode = 'standard',
  otherImageMetadata
}) => {
  const metadata = image.metadata?.normalizedMetadata;
  const isDiffMode = viewMode === 'diff';

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
          {(metadata.prompt || (isDiffMode && otherImageMetadata?.prompt)) && (
            <MetadataField
              label="Prompt"
              field="prompt"
              value={metadata.prompt}
              otherValue={otherImageMetadata?.prompt}
              isDiffMode={isDiffMode}
              onCopy={metadata.prompt ? () => copyToClipboard(metadata.prompt, 'Prompt') : undefined}
              multiline
            />
          )}

          {/* Negative Prompt */}
          {(metadata.negativePrompt || (isDiffMode && otherImageMetadata?.negativePrompt)) && (
            <MetadataField
              label="Negative Prompt"
              field="negativePrompt"
              value={metadata.negativePrompt}
              otherValue={otherImageMetadata?.negativePrompt}
              isDiffMode={isDiffMode}
              onCopy={metadata.negativePrompt ? () => copyToClipboard(metadata.negativePrompt, 'Negative Prompt') : undefined}
              multiline
            />
          )}

          {/* Grid of smaller fields */}
          <div className="grid grid-cols-2 gap-2">
            {(metadata.model || (isDiffMode && otherImageMetadata?.model)) && (
              <MetadataField
                label="Model"
                field="model"
                value={metadata.model}
                otherValue={otherImageMetadata?.model}
                isDiffMode={isDiffMode}
                onCopy={metadata.model ? () => copyToClipboard(metadata.model, 'Model') : undefined}
              />
            )}

            {((metadata.seed !== undefined && metadata.seed !== null) || (isDiffMode && otherImageMetadata?.seed !== undefined)) && (
              <MetadataField
                label="Seed"
                field="seed"
                value={metadata.seed}
                otherValue={otherImageMetadata?.seed}
                isDiffMode={isDiffMode}
                onCopy={metadata.seed !== undefined ? () => copyToClipboard(String(metadata.seed), 'Seed') : undefined}
              />
            )}

            {(metadata.steps || (isDiffMode && otherImageMetadata?.steps)) && (
              <MetadataField
                label="Steps"
                field="steps"
                value={metadata.steps}
                otherValue={otherImageMetadata?.steps}
                isDiffMode={isDiffMode}
                onCopy={metadata.steps ? () => copyToClipboard(String(metadata.steps), 'Steps') : undefined}
              />
            )}

            {(metadata.cfg_scale || (isDiffMode && otherImageMetadata?.cfg_scale)) && (
              <MetadataField
                label="CFG Scale"
                field="cfg_scale"
                value={metadata.cfg_scale}
                otherValue={otherImageMetadata?.cfg_scale}
                isDiffMode={isDiffMode}
                onCopy={metadata.cfg_scale ? () => copyToClipboard(String(metadata.cfg_scale), 'CFG Scale') : undefined}
              />
            )}

            {(metadata.clip_skip || (isDiffMode && otherImageMetadata?.clip_skip)) && (
              <MetadataField
                label="Clip Skip"
                field="clip_skip"
                value={metadata.clip_skip}
                otherValue={otherImageMetadata?.clip_skip}
                isDiffMode={isDiffMode}
                onCopy={metadata.clip_skip ? () => copyToClipboard(String(metadata.clip_skip), 'Clip Skip') : undefined}
              />
            )}

            {((metadata.sampler || metadata.scheduler) || (isDiffMode && (otherImageMetadata?.sampler || otherImageMetadata?.scheduler))) && (
              <MetadataField
                label="Sampler"
                field="sampler"
                value={metadata.sampler || metadata.scheduler}
                otherValue={otherImageMetadata?.sampler || otherImageMetadata?.scheduler}
                isDiffMode={isDiffMode}
                onCopy={(metadata.sampler || metadata.scheduler) ? () => copyToClipboard(metadata.sampler || metadata.scheduler, 'Sampler') : undefined}
              />
            )}

            {((metadata.width && metadata.height) || (isDiffMode && otherImageMetadata?.width && otherImageMetadata?.height)) && (
              <MetadataField
                label="Dimensions"
                field="dimensions"
                value={metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : undefined}
                otherValue={otherImageMetadata?.width && otherImageMetadata?.height ? `${otherImageMetadata.width}x${otherImageMetadata.height}` : undefined}
                isDiffMode={isDiffMode}
                onCopy={(metadata.width && metadata.height) ? () => copyToClipboard(`${metadata.width}x${metadata.height}`, 'Dimensions') : undefined}
              />
            )}
          </div>

          {/* LoRAs if present */}
          {((metadata.loras && metadata.loras.length > 0) || (isDiffMode && otherImageMetadata?.loras && otherImageMetadata.loras.length > 0)) && (
            <MetadataField
              label="LoRAs"
              field="loras"
              value={metadata.loras}
              otherValue={otherImageMetadata?.loras}
              isDiffMode={isDiffMode}
              onCopy={metadata.loras && metadata.loras.length > 0 ? () => copyToClipboard(formatFieldValue('loras', metadata.loras), 'LoRAs') : undefined}
              multiline
            />
          )}

          {/* Generator if present */}
          {(metadata.generator || (isDiffMode && otherImageMetadata?.generator)) && (
            <MetadataField
              label="Generator"
              field="generator"
              value={metadata.generator}
              otherValue={otherImageMetadata?.generator}
              isDiffMode={isDiffMode}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(ComparisonMetadataPanel);
