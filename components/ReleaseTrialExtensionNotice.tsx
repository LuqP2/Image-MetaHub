import { useTranslation } from '../i18n/useTranslation';
import { useState } from 'react';
import { useLicenseStore } from '../store/useLicenseStore';

interface Props {
  changelogReady: boolean;
  changelogOpen: boolean;
}

export default function ReleaseTrialExtensionNotice({ changelogReady, changelogOpen }: Props) {
  const { t } = useTranslation();
  const extension = useLicenseStore((state) => state.trialRelease023);
  const [dismissing, setDismissing] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  if (!changelogReady || changelogOpen || !extension?.grantedAt || extension.noticeDismissed) return null;

  const dismiss = async () => {
    setDismissing(true);
    setSaveFailed(false);
    try {
      const result = await window.electronAPI.dismissReleaseTrialExtensionNotice();
      if (!result.success) throw new Error(result.error);
      await useLicenseStore.persist.rehydrate();
    } catch {
      setSaveFailed(true);
    } finally {
      setDismissing(false);
    }
  };

  return (
    <aside aria-labelledby="release-trial-extension-title" className="fixed bottom-5 right-5 z-[90] w-80 max-w-[calc(100vw-2.5rem)] rounded-lg border border-gray-700 bg-gray-900 p-4 shadow-lg">
      <div role="status">
        <h2 id="release-trial-extension-title" className="text-sm font-semibold text-white">{t('licensing.extendedTitle')}</h2>
        <p className="mt-1 text-sm text-gray-300">{t('licensing.extendedBody', { days: 3, version: '0.23.0' })}</p>
      </div>
      {saveFailed && <p role="alert" className="mt-2 text-sm text-red-400">{t('licensing.dismissFailed')}</p>}
      <button
        type="button"
        onClick={() => void dismiss()}
        disabled={dismissing}
        className="mt-3 rounded border border-gray-700 px-3 py-1 text-sm font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-50"
      >
        {t('licensing.gotIt')}
      </button>
    </aside>
  );
}
