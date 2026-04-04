import React from 'react';
import { ChevronDown } from 'lucide-react';

interface AdvancedSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export const AdvancedSection: React.FC<AdvancedSectionProps> = ({
  title,
  description,
  children,
  defaultOpen = false,
}) => {
  return (
    <details
      className="group rounded-2xl border border-gray-700/80 bg-gray-900/50"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 md:px-5">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-100">{title}</p>
          {description ? <p className="text-sm text-gray-400">{description}</p> : null}
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-gray-800 px-4 py-4 md:px-5">{children}</div>
    </details>
  );
};
