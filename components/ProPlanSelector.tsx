import React from 'react';
import { Crown, X } from 'lucide-react';
import {
  buildProCheckoutUrl,
  type ProLicenseUrlContext,
} from '../utils/creatorAttribution';

interface ProPlanCheckoutOptionsProps {
  token?: string | null;
  ctx?: ProLicenseUrlContext;
  feature?: string;
  compact?: boolean;
}

const checkoutLinkClassName =
  'inline-flex items-center justify-center rounded-lg text-sm font-semibold transition-colors';

/** Reusable direct-checkout choices for every in-app Pro purchase surface. */
export const ProPlanCheckoutOptions: React.FC<ProPlanCheckoutOptionsProps> = ({
  token,
  ctx,
  feature,
  compact = false,
}) => {
  const lifetimeUrl = buildProCheckoutUrl('lifetime', token, ctx, feature);
  const annualUrl = buildProCheckoutUrl('annual', token, ctx, feature);
  const monthlyUrl = buildProCheckoutUrl('monthly', token, ctx, feature);

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <a
        href={lifetimeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${checkoutLinkClassName} w-full gap-2 bg-purple-600 px-4 py-3 text-white hover:bg-purple-700`}
      >
        <Crown className="h-4 w-4" />
        Get Lifetime License — $39
      </a>
      <p className="text-center text-xs text-gray-400">One-time payment · no renewal</p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <a
          href={annualUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${checkoutLinkClassName} border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 hover:bg-gray-700`}
        >
          Annual — $19.99/year
        </a>
        <a
          href={monthlyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${checkoutLinkClassName} border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 hover:bg-gray-700`}
        >
          Monthly — $4.99/month
        </a>
      </div>
      {!compact ? (
        <p className="text-center text-xs text-gray-500">Annual is equivalent to $1.67/month. Every plan unlocks the same Pro features.</p>
      ) : null}
    </div>
  );
};

interface ProPlanSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  token?: string | null;
  ctx?: ProLicenseUrlContext;
  feature?: string;
}

export const ProPlanSelectorModal: React.FC<ProPlanSelectorModalProps> = ({
  isOpen,
  onClose,
  token,
  ctx,
  feature,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a Pro plan"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-700 p-5">
          <div>
            <div className="mb-2 inline-flex rounded-lg bg-purple-600/20 p-2">
              <Crown className="h-5 w-5 text-purple-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Choose your Pro plan</h2>
            <p className="mt-1 text-sm text-gray-400">Every plan unlocks the same Pro features.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
            aria-label="Close plan selection"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">
          <ProPlanCheckoutOptions token={token} ctx={ctx} feature={feature} />
          {token ? (
            <p className="mt-3 text-center text-xs text-gray-500">Creator attribution will be included at checkout.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
};
