import { useTranslation } from '../i18n/useTranslation';
import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { TRIAL_EXTENSION_DAYS, useLicenseStore } from '../store/useLicenseStore';

interface TrialExtensionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TrialExtensionModal: React.FC<TrialExtensionModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { canExtendTrial } = useFeatureAccess();
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setError(null);
  }, [isOpen]);

  // Another renderer may activate the extension or a paid license while this
  // offer is open. Release the parent's modal state as well as hiding the UI.
  useEffect(() => {
    if (isOpen && !canExtendTrial && !isActivating) onClose();
  }, [isOpen, canExtendTrial, isActivating, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isActivating) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isActivating, onClose]);

  if (!isOpen || !canExtendTrial) return null;

  const activate = async () => {
    setIsActivating(true);
    setError(null);
    try {
      if (await useLicenseStore.getState().activateTrialExtension()) {
        onClose();
      } else {
        setError(useLicenseStore.getState().licenseMessage || '');
      }
    } catch {
      setError('');
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="trial-extension-title" className="relative w-full max-w-md rounded-xl border border-accent/30 bg-gray-900 p-6 shadow-2xl">
        <button type="button" onClick={onClose} disabled={isActivating} aria-label={t('licensing.closeExtra')} className="absolute right-3 top-3 rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-50">
          <X size={20} />
        </button>
        <Sparkles size={28} className="mb-4 text-accent" />
        <h2 id="trial-extension-title" className="text-xl font-semibold text-white">{t('licensing.extraTitle', { days: TRIAL_EXTENSION_DAYS })}</h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-300">{t('licensing.extraBody', { days: TRIAL_EXTENSION_DAYS })}</p>
        <p className="mt-2 text-sm text-gray-400">{t('licensing.extraHelp')}</p>
        {error !== null && <p role="alert" className="mt-4 text-sm text-red-400">{!error || error === 'The extra trial could not be started.' || error === 'The extra trial could not be started. Please try again.' ? t('licensing.extraFailed') : error}</p>}
        <button type="button" onClick={() => void activate()} disabled={isActivating} autoFocus className="mt-6 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50">
          {isActivating ? t('licensing.activating') : t('shell.extendTrial', { days: TRIAL_EXTENSION_DAYS })}
        </button>
        <button type="button" onClick={onClose} disabled={isActivating} className="mt-3 w-full py-1 text-sm text-gray-400 hover:text-white disabled:opacity-50">{t('licensing.maybeLater')}</button>
      </div>
    </div>
  );
};

export default TrialExtensionModal;
