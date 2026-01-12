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
      let response;
      let text = '';
      try {
        response = await fetch('/CHANGELOG.md');
        text = await response.text();
      } catch (err) {
        // Electron fallback
        try {
          response = await fetch('CHANGELOG.md');
          text = await response.text();
        } catch (err2) {
          setChangelog('# Changelog\n\nFailed to load changelog. Please visit our GitHub releases page.');
          setLoading(false);
          return;
        }
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
              <div className="mb-6 p-4 bg-gradient-to-br from-blue-900/20 to-purple-900/20 border border-blue-500/30 rounded-lg">
                <h3 className="text-lg font-semibold text-blue-300 mb-3">Message from the Dev</h3>
                <div className="text-gray-300 space-y-3 text-sm leading-relaxed">
                  <p>Hey, I'm Lucas, the solo dev behind Image MetaHub.</p>

                  <p><strong className="text-white">Yes, I know I just released v0.11 a few days ago!</strong></p>

                  <p>I wanted to quickly push <strong>v0.12.0</strong> because I fell down a rabbit hole of algorithms this weekend and built something I could not wait to share: the <strong>Smart Library</strong>.</p>

                  <p>This update brings local intelligence to your chaos. Using <strong>TF-IDF vectorization</strong> and clustering algorithms, the app now automatically detects similar images (like variations of the same prompt) and stacks them for you.</p>

                  <div className="my-4 p-3 bg-purple-900/20 border border-purple-500/30 rounded-lg">
                    <p className="font-semibold text-purple-300 mb-2">Introducing MetaHub Custom Nodes for ComfyUI</p>
                    <p className="mb-3">Two new custom nodes designed specifically for Image MetaHub:</p>
                    <ul className="list-disc list-inside space-y-1 mb-3 ml-2">
                      <li><strong className="text-white">MetaHub Save Node</strong> - Guarantees full metadata compatibility with auto-extraction of all generation parameters</li>
                      <li><strong className="text-white">MetaHub Timer Node</strong> - Provides accurate performance tracking (generation time, steps/second)</li>
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href="https://registry.comfy.org/publishers/image-metahub/nodes/imagemetahub-comfyui-save"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/80 hover:bg-purple-600 text-white text-xs font-medium rounded-full transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z"/>
                        </svg>
                        ComfyUI Registry
                      </a>
                      <a
                        href="https://github.com/LuqP2/ImageMetaHub-ComfyUI-Save"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-700/80 hover:bg-gray-700 text-white text-xs font-medium rounded-full transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                          <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                        </svg>
                        GitHub
                      </a>
                    </div>
                  </div>

                  <div className="mt-3">
                    <p className="font-semibold text-gray-200">New Organizational Tools (Early Access):</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li><strong className="text-white">Auto-Tagging</strong>: The engine now suggests tags based on your metadata. (Note: tools to manually refine/edit these auto-tags are coming in the next update.)</li>
                    </ul>
                  </div>

                  <div className="mt-3">
                    <p className="font-semibold text-gray-200">Experimental / Alpha Features:</p>
                    <p><strong className="text-white">Deduplication Helper</strong>: I included a very early prototype of the deduplication tool. It is currently extremely basic/experimental. Feel free to poke around, but please wait for v0.12.1 before relying on it for heavy cleaning. I decided to leave it visible so you can see the direction we are heading.</p>
                  </div>

                  <div className="mt-3">
                    <p className="font-semibold text-gray-200">Work in Progress:</p>
                    <p>Because we moved so fast, some UI aspects might still need tweaking. If you spot something weird, please open an <strong className="text-white">Issue on GitHub</strong>. This project thrives on your reports and contributions.</p>
                  </div>

                  <p className="font-medium mt-4">A big thank you to everyone who jumped on board with the last update, submitting reports and feedback. And especially to the <strong className="text-white">Pro supporters</strong> - this weekend sprint was fueled directly by your support. Thank you for believing in the project!</p>
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
