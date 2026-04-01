import React from 'react';

type IntegrationStatus = 'unknown' | 'connected' | 'error';

interface IntegrationCardProps {
  name: string;
  description: string;
  status: IntegrationStatus;
  children: React.ReactNode;
}

const statusMap: Record<IntegrationStatus, { label: string; className: string }> = {
  unknown: {
    label: 'Not tested',
    className: 'border-gray-700 bg-gray-800 text-gray-300',
  },
  connected: {
    label: 'Connected',
    className: 'border-green-500/30 bg-green-500/10 text-green-300',
  },
  error: {
    label: 'Connection failed',
    className: 'border-red-500/30 bg-red-500/10 text-red-300',
  },
};

export const IntegrationCard: React.FC<IntegrationCardProps> = ({ name, description, status, children }) => {
  const statusConfig = statusMap[status];

  return (
    <div className="rounded-2xl border border-gray-700/80 bg-gray-900/70 p-4 md:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-gray-100">{name}</h3>
          <p className="text-sm text-gray-400">{description}</p>
        </div>
        <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${statusConfig.className}`}>
          {statusConfig.label}
        </span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
};
