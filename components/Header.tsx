import React from 'react';
import { Settings, Bug, BarChart3 } from 'lucide-react';

interface HeaderProps {
  onOpenSettings: () => void;
  onOpenAnalytics: () => void;
}

const Header: React.FC<HeaderProps> = ({ onOpenSettings, onOpenAnalytics }) => {
  return (
    <header className="bg-gray-800/80 backdrop-blur-sm sticky top-0 z-10 p-4 shadow-md">
      <div className="container mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="logo1.png" alt="Image MetaHub" className="h-14 w-14 rounded-md" />
          <h1 className="text-2xl font-bold tracking-wider">Image MetaHub v0.10.0</h1>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/LuqP2/Image-MetaHub/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="px-2 py-2 rounded-lg transition-colors text-sm text-gray-400 hover:bg-gray-700 hover:text-gray-50 flex items-center gap-2"
            title="Report a bug or provide feedback"
          >
            <Bug size={16} />
            Feedback & Bugs
          </a>
          <div className="border-l border-gray-600 h-8 mx-2"></div>
          <button
            onClick={onOpenAnalytics}
            className="p-2 rounded-full hover:bg-gray-700 transition-colors hover:shadow-lg hover:shadow-blue-400/30"
            title="Open Analytics"
          >
            <BarChart3 size={20} />
          </button>
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-full hover:bg-gray-700 transition-colors hover:shadow-lg hover:shadow-accent/30"
            title="Open Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;