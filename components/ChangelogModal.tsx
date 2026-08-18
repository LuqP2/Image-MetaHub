import React, { useEffect, useState } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { buildProLicenseUrl } from '../utils/creatorAttribution';

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVersion: string;
}

const ChangelogModal: React.FC<ChangelogModalProps> = ({ isOpen, onClose, currentVersion }) => {
  const [changelog, setChangelog] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const creatorAttributionToken = useSettingsStore((state) => state.creatorAttributionToken);
  const proLicenseUrl = buildProLicenseUrl(creatorAttributionToken, 'about');

  useEffect(() => {
    if (isOpen) {
      loadChangelog();
    }
  }, [isOpen]);

  const loadChangelog = async () => {
    setLoading(true);
    try {
      const sources = ['/CHANGELOG.md', 'CHANGELOG.md'];
      let text = '';
      let lastError: unknown = null;

      for (const source of sources) {
        try {
          const response = await fetch(source);
          if (!response.ok) {
            throw new Error(`Failed to load ${source}: ${response.status} ${response.statusText}`);
          }

          text = await response.text();
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!text) {
        throw lastError ?? new Error('Unable to load changelog');
      }

      // Extract only the current version section
      const versionRegex = new RegExp(`## \\[${currentVersion}\\][\\s\\S]*?(?=## \\[|$)`, 'i');
      const match = text.match(versionRegex);

      if (match) {
        setChangelog(match[0]);
      } else {
        // Fallback: show first version section
        const firstVersionRegex = /## \[[^\]]+\][\s\\S]*?(?=## \[|$)/;
        const firstMatch = text.match(firstVersionRegex);
        setChangelog(firstMatch ? firstMatch[0] : text);
      }
    } catch (error) {
      console.warn('[ChangelogModal] Failed to load changelog', error);
      setChangelog('# Changelog\n\nFailed to load changelog. Please visit our GitHub releases page.');
    } finally {
      setLoading(false);
    }
  };

  const openGitHubReleases = () => {
    const url = `https://github.com/LuqP2/Image-MetaHub/releases/tag/v${currentVersion}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const renderMarkdownLink = (text: string | React.ReactNode) => {
    if (typeof text !== 'string') return text;

    // Parse markdown links [text](url)
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    const parts: (string | React.JSX.Element)[] = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      parts.push(
        <a
          key={`link-${match.index}`}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {match[1]}
        </a>
      );
      lastIndex = linkRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  const renderMarkdown = (text: string) => {
    // Simple markdown rendering
    const lines = text.split('\n');
    return lines.map((line, index) => {
      // Headers
      if (line.startsWith('### ')) {
        return <h3 key={index} className="text-lg font-semibold text-gray-200 mt-4 mb-2">{line.replace('### ', '')}</h3>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={index} className="text-xl font-bold text-gray-100 mt-6 mb-4">{line.replace(/## \[([^\]]+)\].*/, '$1')}</h2>;
      }
      // List items
      if (line.startsWith('- **')) {
        const content = line.replace(/^- \*\*([^*]+)\*\*:\s*/, '');
        return <li key={index} className="text-gray-300"><strong>{line.match(/^- \*\*([^*]+)\*\*/)![1]}</strong>: {renderMarkdownLink(content)}</li>;
      }
      if (line.startsWith('- ')) {
        return <li key={index} className="text-gray-300">{renderMarkdownLink(line.replace('- ', ''))}</li>;
      }
      // Empty lines
      if (line.trim() === '') {
        return <div key={index} className="h-2" />;
      }
      // Regular text
      return <p key={index} className="text-gray-300 mb-2">{renderMarkdownLink(line)}</p>;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-gray-100">What's New</h2>
            <p className="text-gray-400 text-sm mt-1">Image MetaHub v{currentVersion}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            title="Close"
            aria-label="Close changelog"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
            </div>
          ) : (
            <>
              {/* Message for the Dev */}
              <div className="mb-6 p-4 bg-gradient-to-br from-blue-900/20 to-purple-900/20 border border-blue-500/30 rounded-lg">
                <h3 className="text-lg font-semibold text-blue-300 mb-3">Message from the Dev</h3>
                <div className="space-y-3 text-sm leading-relaxed">
                  <p className="text-gray-300">
                    Hey there, this is Lucas - the solo dev behind Image MetaHub
                  </p>
                  <p className="text-gray-300">
                    v0.19 is a pretty big update with the main new features being local visual search (CLIP) and support to 3D assets. As usual, its a first implementation that, although functional, might still need a bit of trimming around the edges. Let me know what you think.
                  </p>
                  <p className="text-gray-300">
                    There's also an important change to licensing that IMH now uses a new license format; if you already own a license, a replacement license has been sent to the e-mail address used for your purchase. Your existing purchase is still valid, you'll just need to activate using the new key.{' '}
                  </p>
                  <p className="text-gray-300">
                    One other change worth calling out: the Pro Trial is no longer available in the Portable version. It can still be accessed in the regular installed version of IMH.
                  </p>
                  <p className="text-gray-300">
                    Before you go, I’d really appreciate it if you could {renderMarkdownLink('[answer the short anonymous survey](https://forms.gle/7WKvUC5RVf9Mx9jF7)')}. It directly helps me figure out what’s worth working on next.
                  </p>
                  <p className="text-gray-300">
                    And if you want to chat, share feedback, show what you’re working on, or just make the place feel a little less abandoned, {renderMarkdownLink('[come join the Discord](https://discord.gg/2MXWxjKyJ5)')}. It’s been a bit quiet in there lately. 😅
                  </p>
                  <p className="text-gray-300">
                    Thanks for sticking around, and if you have any issues, suggestions, criticism or feature request, please open an Issue on GitHub or contact me directly on  {renderMarkdownLink('[Discord](https://discord.gg/2MXWxjKyJ5)')} or through imagemetahub@gmail.com
                  </p>
                  <p className="text-gray-300">
                    Back to shipping
                  </p>
                  <p className="text-gray-300">
                    - Lucas
                  </p>

                  {/* Badges */}
                  <div className="flex gap-3 mt-6 pt-4 border-t border-blue-500/20 flex-wrap">
                    <a
                      href={proLicenseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Get Pro
                    </a>
                    <a
                      href="https://discord.gg/2MXWxjKyJ5"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Join Discord
                    </a>
                  </div>
                </div>
              </div>

              {/* Changelog Content */}
              <div className="prose prose-invert prose-sm max-w-none">
                <ul className="list-disc list-inside space-y-1">
                  {renderMarkdown(changelog)}
                </ul>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-700 bg-gray-900/50">
          <button
            onClick={openGitHubReleases}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            <ExternalLink size={16} />
            View Full Release Notes
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-accent hover:bg-blue-700 text-white rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChangelogModal;
