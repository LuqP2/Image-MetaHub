import React, { useEffect, useRef, useState } from 'react';
import hotkeyManager from '../services/hotkeyManager';

export interface CollectionFormValues {
  name: string;
  description: string;
  sourceTag: string;
  autoUpdate: boolean;
  includeTargetImages: boolean;
  configureAutomationRules?: boolean;
}

interface CollectionFormModalProps {
  isOpen: boolean;
  title: string;
  submitLabel: string;
  initialValues: CollectionFormValues;
  onClose: () => void;
  onSubmit: (values: CollectionFormValues) => Promise<void> | void;
  subtitle?: string;
  showSourceTag?: boolean;
  disableSourceTag?: boolean;
  showAutoUpdate?: boolean;
  showIncludeTargetImages?: boolean;
  includeTargetImagesLabel?: string;
  showAutomationRulesOption?: boolean;
}

const CollectionFormModal: React.FC<CollectionFormModalProps> = ({
  isOpen,
  title,
  submitLabel,
  initialValues,
  onClose,
  onSubmit,
  subtitle,
  showSourceTag = false,
  disableSourceTag = false,
  showAutoUpdate = false,
  showIncludeTargetImages = false,
  includeTargetImagesLabel = 'Add the current images now',
  showAutomationRulesOption = false,
}) => {
  const {
    name: initialName,
    description: initialDescription,
    sourceTag: initialSourceTag,
    autoUpdate: initialAutoUpdate,
    includeTargetImages: initialIncludeTargetImages,
  } = initialValues;
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<CollectionFormValues>({
    name: initialName,
    description: initialDescription,
    sourceTag: initialSourceTag,
    autoUpdate: initialAutoUpdate,
    includeTargetImages: initialIncludeTargetImages,
    configureAutomationRules: initialValues.configureAutomationRules ?? false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const hasSourceTag = values.sourceTag.trim().length > 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setValues({
      name: initialName,
      description: initialDescription,
      sourceTag: initialSourceTag,
      autoUpdate: initialAutoUpdate,
      includeTargetImages: initialIncludeTargetImages,
      configureAutomationRules: initialValues.configureAutomationRules ?? false,
    });
    setIsSubmitting(false);
    setIsAdvancedOpen(false);
  }, [
    initialAutoUpdate,
    initialDescription,
    initialIncludeTargetImages,
    initialName,
    initialSourceTag,
    initialValues.configureAutomationRules,
    isOpen,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    hotkeyManager.pauseHotkeys();

    return () => {
      hotkeyManager.resumeHotkeys();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const focusTitleInput = () => {
      titleInputRef.current?.focus({ preventScroll: true });
    };

    const animationFrameId =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(focusTitleInput)
        : null;
    const timeoutId = window.setTimeout(focusTitleInput, 0);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      window.clearTimeout(timeoutId);
    };
  }, [isOpen]);

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
        configureAutomationRules: values.configureAutomationRules ?? false,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
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
          {subtitle && <p className="mt-1 text-xs text-gray-400">{subtitle}</p>}
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Title</span>
            <input
              ref={titleInputRef}
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
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Auto-Add Tags</span>
              <input
                type="text"
                value={values.sourceTag}
                disabled={disableSourceTag}
                onChange={(event) => setValues((current) => ({ ...current, sourceTag: event.target.value }))}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
                placeholder=""
              />
              <span className="mt-1 block text-xs text-gray-500">Separate tags with commas.</span>
            </label>
          )}

          {showAutoUpdate && (
            <label className="flex items-start gap-3 rounded-xl border border-gray-700 bg-gray-800/50 px-3 py-3">
              <input
                type="checkbox"
                checked={hasSourceTag ? values.autoUpdate : false}
                disabled={!hasSourceTag}
                onChange={(event) => setValues((current) => ({ ...current, autoUpdate: event.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span>
                <span className="block text-sm font-medium text-gray-100">Add matching tagged images automatically</span>
                <span className="mt-1 block text-xs text-gray-400">
                  {hasSourceTag
                    ? 'New images with this tag will appear here automatically.'
                    : 'Choose a tag above to enable this.'}
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
              </span>
            </label>
          )}

          {showAutomationRulesOption && (
            <div className="rounded-xl border border-gray-700 bg-gray-800/40">
              <button
                type="button"
                onClick={() => setIsAdvancedOpen((current) => !current)}
                className="flex w-full items-center justify-between px-3 py-3 text-left text-sm text-gray-200 transition-colors hover:bg-gray-800/70"
              >
                <span className="font-medium">Advanced</span>
                <span className="text-xs text-gray-500">{isAdvancedOpen ? 'Hide' : 'Show'}</span>
              </button>
              {isAdvancedOpen && (
                <label className="flex items-start gap-3 border-t border-gray-700 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={values.configureAutomationRules ?? false}
                    onChange={(event) => setValues((current) => ({
                      ...current,
                      configureAutomationRules: event.target.checked,
                    }))}
                    className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-100">Set up rules after creating</span>
                    <span className="mt-1 block text-xs text-gray-400">
                      Create the collection first, then open Rules with this collection already selected.
                    </span>
                  </span>
                </label>
              )}
            </div>
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
