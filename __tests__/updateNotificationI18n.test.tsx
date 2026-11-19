import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UpdateNotificationModal, { type UpdateNotificationStatus } from '../components/UpdateNotificationModal';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatMessage, languages } from '../i18n/messages.mjs';

describe('update notification localization', () => {
  beforeEach(() => useSettingsStore.getState().resetState());
  afterEach(cleanup);

  it.each(languages)('localizes update states in %s while preserving release contents and actions', (language) => {
    const notes = 'Original release notes {notes} 海';
    const onClose = vi.fn(), onDownload = vi.fn(), onSkip = vi.fn(), onInstallNow = vi.fn();
    const props = {
      isOpen: true, update: { version: '99.0.0', releaseNotes: notes }, progress: { percent: 42 },
      onClose, onDownload, onSkip, onInstallNow,
    };
    const { rerender } = render(<UpdateNotificationModal {...props} status="available" />);
    act(() => useSettingsStore.setState({ language }));
    expect(screen.getByRole('dialog', { name: formatMessage(language, 'updates.available') })).toBeTruthy();
    expect(screen.getByText(notes)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: formatMessage(language, 'updates.download'), exact: true }));
    expect(onDownload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: formatMessage(language, 'updates.skip') }));
    expect(onSkip).toHaveBeenCalledOnce();
    for (const status of ['downloading', 'error', 'downloaded'] as UpdateNotificationStatus[]) {
      rerender(<UpdateNotificationModal {...props} status={status} />);
      if (status === 'downloading') {
        expect(screen.getByText(formatMessage(language, 'updates.downloading'))).toBeTruthy();
        expect((screen.getByRole('button', { name: formatMessage(language, 'updates.close') }) as HTMLButtonElement).disabled).toBe(true);
      } else if (status === 'error') {
        expect(screen.getByText(formatMessage(language, 'updates.failed'))).toBeTruthy();
      } else {
        expect(screen.getByRole('dialog', { name: formatMessage(language, 'updates.ready') })).toBeTruthy();
        expect(screen.getByText(formatMessage(language, 'updates.downloaded', { version: '99.0.0' }))).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: formatMessage(language, 'updates.install') }));
        expect(onInstallNow).toHaveBeenCalledOnce();
      }
    }
  });
});
