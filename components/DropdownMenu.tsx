import React, { useState, useRef, useEffect } from 'react';

/**
 * @interface DropdownOption
 * @description Defines the structure for a dropdown menu option.
 * @property {string} label - The text to display for the option.
 * @property {string} [icon] - An optional icon to display next to the label.
 * @property {() => void} onClick - The function to call when the option is clicked.
 */
interface DropdownOption {
  label: string;
  icon?: string;
  onClick: () => void;
}

/**
 * @interface DropdownMenuProps
 * @description Defines the props for the DropdownMenu component.
 * @property {React.ReactNode} trigger - The element that triggers the dropdown.
 * @property {DropdownOption[]} options - The options to display in the dropdown.
 * @property {string} [className] - Optional CSS class for the component.
 */
interface DropdownMenuProps {
  trigger: React.ReactNode;
  options: DropdownOption[];
  className?: string;
}

/**
 * @function DropdownMenu
 * @description A reusable dropdown menu component.
 * @param {DropdownMenuProps} props - The props for the component.
 * @returns {React.FC<DropdownMenuProps>} - The rendered component.
 */
const DropdownMenu: React.FC<DropdownMenuProps> = ({ trigger, options, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleOptionClick = (option: DropdownOption) => {
    option.onClick();
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <div onClick={() => setIsOpen(!isOpen)}>
        {trigger}
      </div>
      
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-50 min-w-[150px]">
          {options.map((option, index) => (
            <button
              key={index}
              onClick={() => handleOptionClick(option)}
              className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors duration-200 first:rounded-t-lg last:rounded-b-lg flex items-center gap-2"
            >
              {option.icon && <span>{option.icon}</span>}
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default DropdownMenu;