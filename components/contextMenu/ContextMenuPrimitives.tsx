import React from 'react';
import { ChevronRight, Pencil, Folder, Download, Package } from 'lucide-react';
import ProBadge from '../ProBadge';

/**
 * Shared building blocks for the image context menus (Grid/Table today,
 * potentially Modal later). Centralizes the visual classes and the
 * Pro-badge-in-a-dense-list pattern so new groups (Generate, File, ...)
 * don't re-hand-roll button/submenu markup per call site.
 */

export const CONTEXT_MENU_ITEM_CLASS =
  'w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2';

export const CONTEXT_MENU_ITEM_DISABLED_CLASS = `${CONTEXT_MENU_ITEM_CLASS} disabled:opacity-50 disabled:cursor-not-allowed`;

export interface ContextMenuButtonProps {
  onClick: () => void;
  icon?: React.ReactNode;
  label: React.ReactNode;
  disabled?: boolean;
  title?: string;
  /** Show the discrete/subtle Pro badge for this specific item. */
  showProBadge?: boolean;
  proBadgeTooltip?: string;
  className?: string;
}

export const ContextMenuButton: React.FC<ContextMenuButtonProps> = ({
  onClick,
  icon,
  label,
  disabled,
  title,
  showProBadge,
  proBadgeTooltip,
  className,
}) => (
  <button
    onClick={onClick}
    className={className ?? CONTEXT_MENU_ITEM_DISABLED_CLASS}
    disabled={disabled}
    title={title}
  >
    {icon}
    <span className="flex-1">{label}</span>
    {showProBadge && <ProBadge size="sm" variant="subtle" tooltip={proBadgeTooltip} />}
  </button>
);

export interface ContextMenuSubmenuProps {
  label: React.ReactNode;
  icon?: React.ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  horizontalClass: string;
  /** Single aggregate Pro badge shown on the parent when any child item is Pro-gated. */
  showProBadge?: boolean;
  proBadgeTooltip?: string;
  minWidthClass?: string;
  children: React.ReactNode;
}

export const ContextMenuSubmenu: React.FC<ContextMenuSubmenuProps> = ({
  label,
  icon,
  isOpen,
  onOpenChange,
  horizontalClass,
  showProBadge,
  proBadgeTooltip,
  minWidthClass = 'min-w-[210px]',
  children,
}) => (
  <div
    className="relative"
    onMouseEnter={() => onOpenChange(true)}
    onMouseLeave={() => onOpenChange(false)}
  >
    <button
      onClick={() => onOpenChange(!isOpen)}
      className={CONTEXT_MENU_ITEM_CLASS}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {showProBadge && <ProBadge size="sm" variant="subtle" tooltip={proBadgeTooltip} />}
      <ChevronRight className="w-4 h-4 text-gray-400" />
    </button>

    {isOpen && (
      <div className={`absolute top-0 ${minWidthClass} rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl ${horizontalClass}`}>
        {children}
      </div>
    )}
  </div>
);

export interface FileMenuItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  isPro: boolean;
}

export interface BuildFileMenuItemsArgs {
  onRename: () => void;
  onCopyTo: () => void;
  onMoveTo: () => void;
  onShowInFolder: () => void;
  onExport: () => void;
  onBatchExport: () => void;
  selectedCount: number;
  canUseFileManagement: boolean;
  canUseBatchExport: boolean;
}

/**
 * Shared File submenu contents (Rename/Copy To/Move To/Show in Folder/
 * Export/Batch Export) used identically by ImageGrid and ImageTable so the
 * two menus can't drift out of sync.
 */
export const buildFileMenuItems = ({
  onRename,
  onCopyTo,
  onMoveTo,
  onShowInFolder,
  onExport,
  onBatchExport,
  selectedCount,
  canUseFileManagement,
  canUseBatchExport,
}: BuildFileMenuItemsArgs): FileMenuItem[] => [
  {
    key: 'rename',
    icon: <Pencil className="w-4 h-4" />,
    label: 'Rename...',
    onClick: onRename,
    isPro: false,
  },
  {
    key: 'copy-to',
    icon: <Folder className="w-4 h-4" />,
    label: 'Copy To...',
    onClick: onCopyTo,
    isPro: !canUseFileManagement,
  },
  {
    key: 'move-to',
    icon: <Folder className="w-4 h-4" />,
    label: 'Move To...',
    onClick: onMoveTo,
    isPro: !canUseFileManagement,
  },
  {
    key: 'show-in-folder',
    icon: <Folder className="w-4 h-4" />,
    label: 'Show in Folder',
    onClick: onShowInFolder,
    isPro: false,
  },
  {
    key: 'export',
    icon: <Download className="w-4 h-4" />,
    label: 'Export Image',
    onClick: onExport,
    isPro: false,
  },
  ...(selectedCount > 1
    ? [{
        key: 'batch-export',
        icon: <Package className="w-4 h-4" />,
        label: `Batch Export Selected (${selectedCount})`,
        onClick: onBatchExport,
        isPro: !canUseBatchExport,
      }]
    : []),
];
