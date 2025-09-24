import React from 'react';

interface BrowserCompatibilityWarningProps {
  className?: string;
}

const BrowserCompatibilityWarning: React.FC<BrowserCompatibilityWarningProps> = ({ className = '' }) => {
  // Detect File System Access API availability
  const hasFileSystemAccessAPI = 'showDirectoryPicker' in window;

  // Detect browser
  const getBrowserInfo = () => {
    const userAgent = navigator.userAgent;

    if (userAgent.includes('Chrome') && !userAgent.includes('Edg') && !userAgent.includes('OPR')) {
      return { name: 'Chrome', supported: true };
    }
    if (userAgent.includes('Firefox')) {
      return { name: 'Firefox', supported: false };
    }
    if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      return { name: 'Safari', supported: false };
    }
    if (userAgent.includes('Edg')) {
      return { name: 'Edge', supported: true };
    }
    if (userAgent.includes('OPR') || userAgent.includes('Opera')) {
      return { name: 'Opera', supported: true };
    }
    if (userAgent.includes('Brave')) {
      return { name: 'Brave', supported: false };
    }

    // Default to unknown but assume supported for newer browsers
    return { name: 'Unknown', supported: true };
  };

  const browserInfo = getBrowserInfo();

  // If API is available or browser is supported, don't show warning
  if (hasFileSystemAccessAPI || browserInfo.supported) {
    return null;
  }

  return (
    <div className={`bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4 ${className}`}>
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-yellow-800">
            Browser Compatibility Notice
          </h3>
          <div className="mt-2 text-sm text-yellow-700">
            <p>
              You're using {browserInfo.name}, which doesn't support the File System Access API needed for local file browsing.
            </p>
            <p className="mt-2">
              For the best experience, please use:
            </p>
            <ul className="mt-1 list-disc list-inside space-y-1">
              <li><strong>Chrome</strong> or <strong>Vivaldi</strong> browser</li>
              <li><strong>Microsoft Edge</strong></li>
              <li>Or download the <strong>Desktop App</strong> for full functionality</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrowserCompatibilityWarning;
