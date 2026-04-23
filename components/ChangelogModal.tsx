import React, { useEffect, useState } from 'react';
import { X, ExternalLink, Github, BadgeCheck, Puzzle } from 'lucide-react';

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
        const content = line.replace(/^- \*\*([^*]+)\*\*:\s*(.*)/, '<strong>$1</strong>: $2');
        return <li key={index} className="text-gray-300" dangerouslySetInnerHTML={{ __html: content }} />;
      }
      if (line.startsWith('- ')) {
        return <li key={index} className="text-gray-300">{line.replace('- ', '')}</li>;
      }
      // Empty lines
      if (line.trim() === '') {
        return <div key={index} className="h-2" />;
      }
      // Regular text
      return <p key={index} className="text-gray-300 mb-2">{line}</p>;
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
            className="p-2 rounded-lg hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-50"
            title="Close"
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
              {/* Message from the Dev */}
              {/* Message from the Dev */}
<div className="mb-6 p-4 bg-gradient-to-br from-blue-900/20 to-purple-900/20 border border-blue-500/30 rounded-lg">
  <h3 className="text-lg font-semibold text-blue-300 mb-3">Message from the Dev</h3>
  <div className="text-gray-300 space-y-3 text-sm leading-relaxed">
    <p>Hi there, this is Lucas -- the solo dev behind Image MetaHub.</p>

    <p>v0.15 is here with some new and useful features for organizing your library, which include audio support, tag/collection automation rules, metadata editing, and more. Although they are functional, some of these features may feel a bit rough in this first implementation. I felt it was better to ship them as they are now tho, and proceed to polish them over time.</p>

    <p>I also put a lot of focus on making the app more responsive, faster, and more intuitive, I hope you'll notice the difference! One note: during development I did run into a few memory crashes that were mostly fixed. If you do happen to come across one, it would be really helpful if you open an Issue with the console logs!</p>

    <p>A genuine thank you to everyone who helped support development by purchasing a Pro license -- it truly makes a difference, your support is what will turn IMH into a reference point for everyone working with GenMedia. I also want to thank everyone who submitted bug reports and feature requests on GitHub, for actively helping shape the app into something genuinely useful.</p>

    <p>Make sure to join our Discord server! <a href="https://discord.gg/7XgrWCSxfJ" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">https://discord.gg/7XgrWCSxfJ</a></p>

    <div className="flex flex-wrap gap-3 mt-6 pt-4 border-t border-gray-700/50">
      <a
        href="https://github.com/LuqP2/Image-MetaHub"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-full transition-colors"
      >
        <Github size={16} />
        GitHub Project
      </a>
      <a
        href="https://imagemetahub.com/getpro"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 bg-pink-600 hover:bg-pink-500 text-white text-sm font-medium rounded-full transition-colors"
      >
        <BadgeCheck size={16} />
        Get Pro License
      </a>
      <a
        href="https://registry.comfy.org/publishers/image-metahub/nodes/imagemetahub-comfyui-save"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-full transition-colors"
      >
        <Puzzle size={16} />
        ComfyUI Save Node
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
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-accent transition-colors"
          >
            <ExternalLink size={16} />
            View Full Release Notes
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-accent hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChangelogModal;
