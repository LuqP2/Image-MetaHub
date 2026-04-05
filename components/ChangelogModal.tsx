import React, { useEffect, useState } from 'react';
import { X, ExternalLink, Github, Heart, Puzzle } from 'lucide-react';

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
      } catch {
        // Electron fallback
        try {
          response = await fetch('CHANGELOG.md');
          text = await response.text();
        } catch {
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
    } catch {
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
    <p>Hey there, I'm Lucas - solo dev behind Image MetaHub.</p>

    <p>v0.14 is a big one. It adds some very substantial features, especially around ComfyUI workflow inspection/regeneration, improved analytics, improved comparison, and a lot more. Most of it is the result of trying to make the app more useful in the same way I use it myself.</p>

    <p>I started IMH last September, as a tool for my own use, to basically do what the core of the app still is today: search/filter by generation parameters, with support exclusive to InvokeAI. After it got some visibility, I started to expand on it by including support to other generators.</p>

    <p>One thing hasn't changed, tho; I still develop this app for myself, as I'm just a normal mid-tier user who generates as a hobby and share a lot of the pains with people who deal with large libraries. This means that most features I add are things that are useful for myself which end up overlapping with many other users. This is also the reason a lot of things that may seem obvious are overlooked - which is why I thank everyone who help out on GitHub with Bug Reports/Feature Requests.</p>

    <p>Still tho, I'm glad this thing is useful to people. Building it alone means I end up doing development, support, bug fixing, communication, and whatever else needs doing. So if IMH has been useful to you and it ever makes sense to mention it to someone who might benefit from it, that helps a lot!</p>

    <p>As a side note: I hate the term "vibe coding". Sounds like something you would do lounging in a beanbag chair, burning incense, and saying "Take that, bug" while debugging.</p>

    <p>Anyway, make sure to join our Discord server: <a href="https://discord.gg/7XgrWCSxfJ" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">https://discord.gg/7XgrWCSxfJ</a></p>

    <p>And as usual, thanks to everyone who's helped development by downloading IMH, getting a pro license, or contributing on GitHub. Special thanks to nonplayer for their many relevant insights, Taruvi who helped building the base of what the app is today, mankochan11 for helping to test this build, and Silva and Camilo for funding the project.</p>

    <p className="mt-4">Enjoy the update!</p>

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
        <Heart size={16} className="fill-current" />
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
