import React from 'react';
import hotkeyManager from '../services/hotkeyManager';

interface HotkeyHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const HotkeyHelp: React.FC<HotkeyHelpProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const hotkeys = hotkeyManager.getRegisteredHotkeys();

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-700 flex justify-between items-center flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-100">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path></svg>
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {hotkeys.map(({ key, description }) => (
              <div key={key} className="flex items-center justify-between p-2 rounded-md hover:bg-gray-700/50">
                <p className="text-gray-200">{description}</p>
                <div className="flex space-x-1">
                  {key.split(',')[0].split('+').map(part => (
                    <kbd key={part} className="px-2 py-1 text-sm font-sans font-semibold text-gray-200 bg-gray-900 border border-gray-600 rounded-md">
                      {part.replace('cmd', '⌘').replace('ctrl', 'Ctrl').replace('shift', 'Shift').replace('alt', 'Alt').toUpperCase()}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HotkeyHelp;