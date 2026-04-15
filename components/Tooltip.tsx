import React from 'react';

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

const Tooltip: React.FC<TooltipProps> = ({ label, children, className = '' }) => (
  <span className={`relative inline-flex group ${className}`}>
    {children}
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-[90] mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-[11px] font-medium text-gray-100 shadow-xl group-hover:block group-focus-within:block"
    >
      {label}
    </span>
  </span>
);

export default Tooltip;
