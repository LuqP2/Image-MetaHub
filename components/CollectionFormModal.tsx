import React, { useEffect, useState } from 'react';
import { SmartCollection } from '../types';

export interface CollectionFormValues {
  name: string;
  description: string;
  sourceTag: string;
  autoUpdate: boolean;
  includeTargetImages: boolean;
}

interface CollectionFormModalProps {
  isOpen: boolean;
  title: string;
  submitLabel: string;
  initialValues: CollectionFormValues;
  onClose: () => void;
  onSubmit: (values: CollectionFormValues) => Promise<void> | void;
  showSourceTag?: boolean;
  disableSourceTag?: boolean;
  showAutoUpdate?: boolean;
  showIncludeTargetImages?: boolean;
  includeTargetImagesLabel?: string;
  collectionKind?: SmartCollection['kind'];
}

const CollectionFormModal: React.FC<CollectionFormModalProps> = ({
  isOpen,
  title,
  submitLabel,
  initialValues,
  onClose,
  onSubmit,
  showSourceTag = false,
  disableSourceTag = false,
  showAutoUpdate = false,
  showIncludeTargetImages = false,
  includeTargetImagesLabel = 'Add the current images now',
  collectionKind = 'manual',
}) => {
  const [values, setValues] = useState<CollectionFormValues>(initialValues);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setValues(initialValues);
    setIsSubmitting(false);
  }, [initialValues, isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async () => {
    if (!values.name.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        ...values,
        name: values.name.trim(),
        description: values.description.trim(),
        sourceTag: values.sourceTag.trim().toLowerCase(),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="mt-1 text-xs text-gray-400">
            {collectionKind === 'tag_rule'
              ? 'Tag-based collections can stay in sync automatically or freeze the current membership.'
              : 'Manual collections keep only the images you explicitly add.'}
          </p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Title</span>
            <input
              autoFocus
              type="text"
              value={values.name}
              onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Collection name"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Description</span>
            <textarea
              value={values.description}
              onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Optional notes about this collection"
            />
          </label>

          {showSourceTag && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Source Tag</span>
              <input
                type="text"
                value={values.sourceTag}
                disabled={disableSourceTag}
                onChange={(event) => setValues((current) => ({ ...current, sourceTag: event.target.value }))}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
                placeholder="tag name"
              />
            </label>
          )}

          {showAutoUpdate && (
            <label className="flex items-start gap-3 rounded-xl border border-gray-700 bg-gray-800/50 px-3 py-3">
              <input
                type="checkbox"
                checked={values.autoUpdate}
                onChange={(event) => setValues((current) => ({ ...current, autoUpdate: event.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-100">Auto-update from future tags</span>
                <span className="mt-1 block text-xs text-gray-400">
                  Keep the collection synced with future images tagged with this source tag.
                </span>
              </span>
            </label>
          )}

          {showIncludeTargetImages && (
            <label className="flex items-start gap-3 rounded-xl border border-gray-700 bg-gray-800/50 px-3 py-3">
              <input
                type="checkbox"
                checked={values.includeTargetImages}
                onChange={(event) => setValues((current) => ({ ...current, includeTargetImages: event.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-100">{includeTargetImagesLabel}</span>
                <span className="mt-1 block text-xs text-gray-400">
                  The current context-menu target can be added immediately when the collection is created.
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting || !values.name.trim()}
            onClick={() => void handleSubmit()}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CollectionFormModal;
