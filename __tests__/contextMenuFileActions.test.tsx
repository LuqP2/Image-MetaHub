import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ShowInFolderContextAction,
  buildFileMenuItems,
} from '../components/contextMenu/ContextMenuPrimitives';

describe('context-menu file actions', () => {
  it('exposes Show in Folder as a direct context-menu action', () => {
    const onClick = vi.fn();
    render(<ShowInFolderContextAction onClick={onClick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show in Folder' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate Show in Folder inside the File submenu', () => {
    const noop = () => undefined;
    const labels = buildFileMenuItems({
      onRename: noop,
      onCopyTo: noop,
      onMoveTo: noop,
      onExport: noop,
      onBatchExport: noop,
      selectedCount: 1,
      canUseFileManagement: true,
      canUseBatchExport: true,
    }).map((item) => item.label);

    expect(labels).not.toContain('Show in Folder');
  });
});
