import React, { useState, useEffect, useMemo } from 'react';

/**
 * @interface Command
 * @description Defines the structure of a command for the CommandPalette.
 * @property {string} id - A unique identifier for the command.
 * @property {string} name - The name of the command.
 * @property {string} description - A brief description of the command.
 * @property {string} [hotkey] - The hotkey associated with the command.
 * @property {() => void} action - The function to execute when the command is triggered.
 */
interface Command {
  id: string;
  name: string;
  description: string;
  hotkey?: string;
  action: () => void;
}

/**
 * @interface CommandPaletteProps
 * @description Defines the props for the CommandPalette component.
 * @property {boolean} isOpen - Whether the command palette is open.
 * @property {() => void} onClose - Callback function to close the command palette.
 * @property {Command[]} commands - An array of commands to display in the palette.
 */
interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
}

/**
 * @function CommandPalette
 * @description A command palette component that allows users to search for and execute commands.
 * @param {CommandPaletteProps} props - The props for the component.
 * @returns {React.FC<CommandPaletteProps> | null} - The rendered component or null if it's not open.
 */
const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, commands }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    if (!searchTerm) return commands;
    // A simple fuzzy search
    return commands.filter(command =>
      command.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      command.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, commands]);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setActiveIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(prev => (prev + 1) % filteredCommands.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[activeIndex]) {
          filteredCommands[activeIndex].action();
          onClose();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, filteredCommands, activeIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-24"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-2xl mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-2">
          <input
            type="text"
            placeholder="Type a command or search..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-gray-900 text-gray-200 placeholder-gray-500 px-4 py-3 rounded-md border-0 focus:ring-2 focus:ring-accent outline-none"
            autoFocus
          />
        </div>
        <div className="border-t border-gray-700 max-h-96 overflow-y-auto">
          {filteredCommands.length > 0 ? (
            <ul>
              {filteredCommands.map((command, index) => (
                <li
                  key={command.id}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    command.action();
                    onClose();
                  }}
                  className={`px-4 py-3 flex justify-between items-center cursor-pointer ${
                    index === activeIndex ? 'bg-accent/20' : 'hover:bg-gray-700/50'
                  }`}
                >
                  <div>
                    <span className="text-gray-100">{command.name}</span>
                    <span className="text-gray-400 ml-3 text-sm">{command.description}</span>
                  </div>
                  {command.hotkey && (
                    <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded-md">{command.hotkey}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 p-8 text-center">No commands found.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;