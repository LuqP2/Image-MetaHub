import React, { useEffect, useState } from 'react';
import { X, ExternalLink } from 'lucide-react';

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVersion: string;
}

const ChangelogModal: React.FC<ChangelogModalProps> = ({ isOpen, onClose, currentVersion }) => {
  const [changelog, setChangelog] = useState<string>('');
  const [loading, setLoading] = useState(true);

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
                    Hi there, I'm Lucas - the solo dev behind Image MetaHub.
                  </p>
                  <p className="text-gray-300">
                    A few things worth 30 seconds: this release unifies the Smart Library/Model View/Collections into a unified Explore workspace. If you prefer the old layout, Settings → Appearance → Classic Mode brings the old labels back. Also, ComfyUI generations now render step-by-step live in the queue, and AVIF files are fully supported (thanks to {renderMarkdownLink('[@austintraver](https://github.com/austintraver)')})
                  </p>
                  <p className="text-gray-300">
                    Two notes on the trial: its now 7 days, if yours already expired youve been given a fresh one with this update. Just open a Pro feature to start it.
                  </p>
                  <p className="text-gray-300">
                    I keep the licensing light on purpose - no aggressive DRM, no phone-home. I'm working on IMH full-time, so if it's actually useful to you and you have the means, a Pro license is what makes that possible.
                  </p>
                  <p className="text-gray-300">
                    By the way, IMH is now listed in the {renderMarkdownLink('[CivitAI Tools Section](https://civitai.com/tools/image-metahub)')}, so if you upload any images there, tagging Image MetaHub as the tool helps a lot!
                  </p>
                  <p className="text-gray-300">
                    Also, if you have two minutes, this short {renderMarkdownLink('[anonymous survey](https://forms.gle/7WKvUC5RVf9Mx9jF7)')} directly shapes the app and it's really helpful to me.
                  </p>
                  <p className="text-gray-300">
                    To everyone who's filed an issue, sent a PR, bought Pro, or just uses the app: thank you!! If you need anything, you can reach me on {renderMarkdownLink('[Discord](https://discord.gg/2MXWxjKyJ5)')}, imagemetahub@gmail.com, or just open an issue on github.
                  </p>

                  {/* Badges */}
                  <div className="flex gap-3 mt-6 pt-4 border-t border-blue-500/20 flex-wrap">
                    <a
                      href="https://imagemetahub.com/getpro.html"
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
