import React, { useEffect, useRef } from 'react';
import { ExrSettingsPanel } from './ExrSettingsPanel';
import { SettingsPanel } from './SettingsPanel';
import type { SettingsFocusSection } from './types';

export function GeneralSettingsPanel({ focusSection }: { focusSection: SettingsFocusSection }) {
  const exrSection = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusSection === 'exr') {
      exrSection.current?.scrollIntoView({ block: 'nearest' });
      exrSection.current?.focus({ preventScroll: true });
    }
  }, [focusSection]);
  return <SettingsPanel title="General" description="Manage optional app components.">
    <section aria-labelledby="optional-components-title" className="space-y-4">
      <h2 id="optional-components-title" className="text-lg font-semibold text-gray-100">Optional components</h2>
      <div ref={exrSection} tabIndex={-1} aria-label="EXR / OpenColorIO" className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <ExrSettingsPanel />
      </div>
    </section>
  </SettingsPanel>;
}
