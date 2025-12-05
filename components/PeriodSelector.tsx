import React from 'react';
import { Calendar } from 'lucide-react';

export type PeriodPreset = '7days' | '30days' | '90days' | 'thisMonth' | 'all';

interface PeriodOption {
  value: PeriodPreset;
  label: string;
  disabled?: boolean;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { value: '7days', label: 'Last 7 Days' },
  { value: '30days', label: 'Last 30 Days' },
  { value: '90days', label: 'Last 90 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'all', label: 'All Time' },
];

interface PeriodSelectorProps {
  selectedPeriod: PeriodPreset;
  onChange: (period: PeriodPreset) => void;
}

const PeriodSelector: React.FC<PeriodSelectorProps> = ({ selectedPeriod, onChange }) => {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 text-gray-400">
        <Calendar size={18} />
        <span className="text-sm font-medium">Period:</span>
      </div>
      <select
        value={selectedPeriod}
        onChange={(e) => onChange(e.target.value as PeriodPreset)}
        className="bg-gray-700 text-gray-200 border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 hover:bg-gray-600 transition-colors cursor-pointer"
      >
        {PERIOD_OPTIONS.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={option.disabled ? 'text-gray-500' : ''}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default PeriodSelector;
