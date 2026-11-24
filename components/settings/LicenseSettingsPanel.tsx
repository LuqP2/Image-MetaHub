import { useTranslation, type MessageKey } from '../../i18n/useTranslation';
import React, { useEffect, useState } from 'react';
import { Crown } from 'lucide-react';
import { useLicenseStore } from '../../store/useLicenseStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { SettingsPanel } from './SettingsPanel';
import { SettingsSectionCard } from './SettingsSectionCard';
import { ProPlanCheckoutOptions } from '../ProPlanSelector';

const licenseStatusClassName: Record<string, string> = {
  free: 'border-gray-700 bg-gray-800 text-gray-300',
  trial: 'border-yellow-300 bg-yellow-100 text-yellow-800 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-200',
  expired: 'border-red-300 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200',
  pro: 'border-green-300 bg-green-100 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-200',
  lifetime: 'border-green-300 bg-green-100 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-200',
};

const licenseStatusKeys = {
  free: 'settings.license.free',
  trial: 'settings.license.trial',
  expired: 'settings.license.trialExpired',
  pro: 'settings.license.pro',
  lifetime: 'settings.license.lifetime',
} as const satisfies Record<string, MessageKey>;

const licensePlanKeys = {
  monthly: 'settings.license.monthly',
  annual: 'settings.license.annual',
  lifetime: 'settings.license.lifetime',
} as const satisfies Record<string, MessageKey>;

const licenseMessageKeys: Readonly<Record<string, MessageKey>> = {
  'Please enter both email and license key.': 'settings.license.pleaseEnterBothEmailAndLicenseKey',
  'License activation requires the desktop app.': 'settings.license.desktopRequired',
  'License service is temporarily unavailable.': 'settings.license.serviceUnavailable',
  'License status is temporarily unavailable.': 'settings.license.statusUnavailable',
  'Invalid license for this email.': 'settings.license.invalidLicense',
  'License has expired.': 'settings.license.licenseExpired',
  'License is not active.': 'settings.license.licenseNotActive',
};

export const LicenseSettingsPanel: React.FC = () => {
  const { t } = useTranslation();
  const licenseStatus = useLicenseStore((state) => state.licenseStatus);
  const licenseEmail = useLicenseStore((state) => state.licenseEmail);
  const licensePlan = useLicenseStore((state) => state.licensePlan);
  const licenseExpiresAt = useLicenseStore((state) => state.licenseExpiresAt);
  const licenseKey = useLicenseStore((state) => state.licenseKey);
  const licenseStoreMessage = useLicenseStore((state) => state.licenseMessage);
  const activateLicense = useLicenseStore((state) => state.activateLicense);
  const creatorAttributionToken = useSettingsStore((state) => state.creatorAttributionToken);
  const paidPlanLabel = licenseStatus === 'pro' || licenseStatus === 'lifetime'
    ? t(licensePlan ? licensePlanKeys[licensePlan] : 'settings.license.pro')
    : t(licenseStatusKeys[licenseStatus]);
  const expiresAt = licenseExpiresAt ? Date.parse(licenseExpiresAt) : NaN;
  const validityLabel = licenseStatus === 'pro' || licenseStatus === 'lifetime'
    ? licensePlan === 'lifetime'
      ? t('settings.license.noExpiration')
      : (licensePlan === 'monthly' || licensePlan === 'annual') && Number.isFinite(expiresAt)
        ? t('settings.license.validThrough', { date: expiresAt })
        : null
    : null;

  const [licenseEmailInput, setLicenseEmailInput] = useState(licenseEmail ?? '');
  const [licenseKeyInput, setLicenseKeyInput] = useState(licenseKey ?? '');
  const [isActivatingLicense, setIsActivatingLicense] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState<{ key: MessageKey } | { detail: string } | null>(null);
  const licenseMessageLabel = licenseMessage && ('key' in licenseMessage
    ? t(licenseMessage.key)
    : Object.hasOwn(licenseMessageKeys, licenseMessage.detail)
      ? t(licenseMessageKeys[licenseMessage.detail])
      : licenseMessage.detail);

  useEffect(() => {
    setLicenseEmailInput(licenseEmail ?? '');
  }, [licenseEmail]);

  useEffect(() => {
    setLicenseKeyInput(licenseKey ?? '');
  }, [licenseKey]);

  useEffect(() => {
    if (licenseStoreMessage) setLicenseMessage({ detail: licenseStoreMessage });
  }, [licenseStoreMessage]);

  const handleActivateLicense = async () => {
    setLicenseMessage(null);
    const email = licenseEmailInput.trim();
    const key = licenseKeyInput.trim();

    if (!email || !key) {
      setLicenseMessage({ key: 'settings.license.pleaseEnterBothEmailAndLicenseKey' });
      return;
    }

    try {
      setIsActivatingLicense(true);
      const success = await activateLicense(key, email);
      const activationMessage = useLicenseStore.getState().licenseMessage;
      setLicenseMessage(
        success
          ? { key: 'settings.license.licenseActivatedThankYouForSupportingThe' }
          : activationMessage ? { detail: activationMessage } : { key: 'settings.license.invalidLicenseForThisEmailPleaseDouble' }
      );
    } finally {
      setIsActivatingLicense(false);
    }
  };

  return (
    <SettingsPanel title={t("settings.license.supportLicense")} description={t("settings.license.activateProOrManageYourCurrentLicense")}>
      <SettingsSectionCard title={t("settings.license.licenseStatus")}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium ${licenseStatusClassName[licenseStatus]}`}>
            {paidPlanLabel}
          </span>
          {licenseEmail ? <span className="text-sm text-gray-400">{t("settings.license.activatedFor", { email: licenseEmail })}</span> : null}
          {validityLabel ? <span className="text-sm text-gray-400">{validityLabel}</span> : null}
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title={t("settings.license.activatePro")}
        description={t("settings.license.pasteTheEmailUsedAtCheckoutAnd")}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-100" htmlFor="license-email">
              {t("settings.license.licenseEmail")}
            </label>
            <input
              id="license-email"
              type="email"
              value={licenseEmailInput}
              onChange={(event) => setLicenseEmailInput(event.target.value)}
              placeholder={t("settings.license.youExampleCom")}
              className="ui-input w-full"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-100" htmlFor="license-key">
              {t("settings.license.licenseKey")}
            </label>
            <input
              id="license-key"
              type="text"
              value={licenseKeyInput}
              onChange={(event) => setLicenseKeyInput(event.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              className="ui-input w-full font-mono"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleActivateLicense}
            disabled={isActivatingLicense}
            className="ui-btn-primary"
          >
            <Crown size={14} />
            {isActivatingLicense ? t("settings.license.activating") : t("settings.license.activateLicense")}
          </button>
          {creatorAttributionToken ? (
            <span className="text-xs text-gray-500">{t("settings.license.creatorAttributionDetected")}</span>
          ) : null}
        </div>

        <div className="border-t border-gray-800 pt-4">
          <p className="mb-2 text-sm font-medium text-gray-200">{t("settings.license.purchasePro")}</p>
          <ProPlanCheckoutOptions token={creatorAttributionToken} ctx="settings" compact />
        </div>

        {licenseMessageLabel ? <p className="text-sm text-gray-300">{licenseMessageLabel}</p> : null}
      </SettingsSectionCard>
    </SettingsPanel>
  );
};
