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
        return <h2 key={index} className="text-xl font-bold text-white mt-6 mb-4">{line.replace(/## \[([^\]]+)\].*/, '$1')}</h2>;
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

  console.log('🔍 Modal state:', { isOpen, loading, changelogLength: changelog.length });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-white">What's New</h2>
            <p className="text-gray-400 text-sm mt-1">Image MetaHub v{currentVersion}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
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
              {/* Developer Message Banner */}
              <div className="mb-6 p-4 bg-gradient-to-r from-purple-900/20 to-blue-900/20 border border-purple-700/30 rounded-lg">
                <div className="prose prose-invert prose-sm max-w-none">
                  <p className="text-gray-300 text-sm leading-relaxed mb-3">
                    <strong className="text-purple-300">Hey — Lucas here</strong>, the guy building Image MetaHub.
                  </p>
                  <p className="text-gray-400 text-xs leading-relaxed mb-3">
                    Quick update and a proper thank-you. The Ko-fi support has been clutch — it literally paid for the unsexy work: bug-fix weeks, packaging hell, test VMs, and time to iterate instead of firefighting. Special thanks to Taruvi for relentless feedback and shaping the app into what I actually envisioned — UX pressure, edge-case hunts, and reality checks that made this better.
                  </p>
                  <p className="text-gray-400 text-xs leading-relaxed mb-3">
                    Traction's been solid. People are using it daily, and that's the bar. The app stays what it's meant to be: fast, local, privacy-first — no cloud bullshit. Support keeps going wider and deeper (Midjourney, Forge, Fooocus, SwarmUI, SD.Next, EasyDiffusion, NijiJourney), with ComfyUI improving and video metadata on the roadmap.
                  </p>
                  <p className="text-gray-400 text-xs leading-relaxed mb-3">
                    If IMH saves you time or brings order to your mess of generations, you can help in a few concrete ways: buy a coffee on Ko-fi, star the repo, report bugs with sample files, or share the project with someone who needs it. That's how this gets better week over week.
                  </p>
                  <p className="text-gray-400 text-xs leading-relaxed mb-3">
                    Thanks for being part of it. Back to shipping.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <a
                      href="https://ko-fi.com/lucaspierri"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs bg-purple-600/80 hover:bg-purple-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      ☕ Ko-fi
                    </a>
                    <a
                      href="https://github.com/LuqP2/Image-MetaHub"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs bg-gray-700/80 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      🔧 GitHub
                    </a>
                  </div>
                  <p className="text-gray-500 text-xs mt-3 italic">
                    — Lucas
                  </p>
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
          <div className="flex flex-col gap-2">
            <button
              onClick={openGitHubReleases}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-accent transition-colors"
            >
              <ExternalLink size={16} />
              View Full Release Notes
            </button>
            <a
              href="https://www.imagemetahub.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 transition-colors"
            >
              <ExternalLink size={16} />
              A message from the dev
            </a>
          </div>
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
