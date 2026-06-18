import React, { useEffect, useState } from 'react';
import { Crown } from 'lucide-react';
import { useLicenseStore } from '../../store/useLicenseStore';
import { SettingsPanel } from './SettingsPanel';
import { SettingsSectionCard } from './SettingsSectionCard';

const licenseStatusClassName: Record<string, string> = {
  free: 'border-gray-700 bg-gray-800 text-gray-300',
  trial: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200',
  expired: 'border-red-500/30 bg-red-500/10 text-red-200',
  pro: 'border-green-500/30 bg-green-500/10 text-green-200',
  lifetime: 'border-green-500/30 bg-green-500/10 text-green-200',
};

const licenseStatusLabel: Record<string, string> = {
  free: 'Free',
  trial: 'Trial',
  expired: 'Trial expired',
  pro: 'Pro',
  lifetime: 'Lifetime',
};

export const LicenseSettingsPanel: React.FC = () => {
  const licenseStatus = useLicenseStore((state) => state.licenseStatus);
  const licenseEmail = useLicenseStore((state) => state.licenseEmail);
  const licenseKey = useLicenseStore((state) => state.licenseKey);
  const activateLicense = useLicenseStore((state) => state.activateLicense);

  const [licenseEmailInput, setLicenseEmailInput] = useState(licenseEmail ?? '');
  const [licenseKeyInput, setLicenseKeyInput] = useState(licenseKey ?? '');
  const [isActivatingLicense, setIsActivatingLicense] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState<string | null>(null);

  useEffect(() => {
    setLicenseEmailInput(licenseEmail ?? '');
  }, [licenseEmail]);

  useEffect(() => {
    setLicenseKeyInput(licenseKey ?? '');
  }, [licenseKey]);

  const handleActivateLicense = async () => {
    setLicenseMessage(null);
    const email = licenseEmailInput.trim();
    const key = licenseKeyInput.trim();

    if (!email || !key) {
      setLicenseMessage('Please enter both email and license key.');
      return;
    }

    try {
      setIsActivatingLicense(true);
      const success = await activateLicense(key, email);
      setLicenseMessage(
        success
          ? 'License activated. Thank you for supporting the project.'
          : 'Invalid license for this email. Please double-check both fields.'
      );
    } finally {
      setIsActivatingLicense(false);
    }
  };

  return (
    <SettingsPanel title="Support / License" description="Activate Pro or manage your current license.">
      <SettingsSectionCard title="License status">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium ${licenseStatusClassName[licenseStatus]}`}>
            {licenseStatusLabel[licenseStatus]}
          </span>
          {licenseEmail ? <span className="text-sm text-gray-400">Activated for {licenseEmail}</span> : null}
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title="Activate Pro"
        description="Paste the email used at checkout and your offline license key."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-100" htmlFor="license-email">
              License email
            </label>
            <input
              id="license-email"
              type="email"
              value={licenseEmailInput}
              onChange={(event) => setLicenseEmailInput(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-100" htmlFor="license-key">
              License key
            </label>
            <input
              id="license-key"
              type="text"
              value={licenseKeyInput}
              onChange={(event) => setLicenseKeyInput(event.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleActivateLicense}
            disabled={isActivatingLicense}
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-gray-700"
          >
            <Crown size={14} />
            {isActivatingLicense ? 'Activating...' : 'Activate license'}
          </button>
          <a
            href="https://imagemetahub.com/getpro"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-300 hover:text-blue-200"
          >
            Get Pro license
          </a>
        </div>

        {licenseMessage ? <p className="text-sm text-gray-300">{licenseMessage}</p> : null}
      </SettingsSectionCard>
    </SettingsPanel>
  );
};
