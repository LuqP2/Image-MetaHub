import React from 'react';
import { Users } from 'lucide-react';
import { useTeamWorkspaceStore } from '../../store/useTeamWorkspaceStore';
import type { TeamReviewFilterValue } from '../../services/team/reviewService';

const FILTER_OPTIONS: Array<{ value: Exclude<TeamReviewFilterValue, 'all'>; label: string; activeClass: string }> = [
  { value: 'approved', label: 'Approved', activeClass: 'border-emerald-500 bg-emerald-600/25 text-emerald-200' },
  { value: 'needs_changes', label: 'Changes', activeClass: 'border-amber-500 bg-amber-600/25 text-amber-200' },
  { value: 'in_review', label: 'In Review', activeClass: 'border-blue-500 bg-blue-600/25 text-blue-200' },
  { value: 'rejected', label: 'Rejected', activeClass: 'border-red-500 bg-red-600/25 text-red-200' },
  { value: 'conflict', label: 'Conflict', activeClass: 'border-rose-500 bg-rose-600/25 text-rose-200' },
  { value: 'unreviewed', label: 'Unreviewed', activeClass: 'border-gray-500 bg-gray-700/60 text-gray-100' },
];

export const TeamReviewFilter: React.FC = () => {
  const workspacesById = useTeamWorkspaceStore((state) => state.workspacesById);
  const reviewStatusFilter = useTeamWorkspaceStore((state) => state.reviewStatusFilter);
  const setReviewStatusFilter = useTeamWorkspaceStore((state) => state.setReviewStatusFilter);

  if (Object.keys(workspacesById).length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs font-medium text-gray-400">
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-blue-400" />
          Team Review
        </span>
        {reviewStatusFilter !== 'all' && (
          <button
            type="button"
            onClick={() => setReviewStatusFilter('all')}
            className="text-[11px] text-blue-400 hover:text-blue-300"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTER_OPTIONS.map((option) => {
          const isActive = reviewStatusFilter === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setReviewStatusFilter(isActive ? 'all' : option.value)}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                isActive
                  ? option.activeClass
                  : 'border-gray-700 bg-gray-800/60 text-gray-300 hover:border-gray-500 hover:text-gray-100'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
