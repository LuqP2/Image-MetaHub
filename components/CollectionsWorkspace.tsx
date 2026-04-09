import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { IndexedImage, SmartCollection } from '../types';
import { useImageStore } from '../store/useImageStore';
import CollectionFormModal, { CollectionFormValues } from './CollectionFormModal';

interface CollectionsWorkspaceProps {
  filteredImages: IndexedImage[];
  totalImages: IndexedImage[];
  children: React.ReactNode;
}

const CollectionsWorkspace: React.FC<CollectionsWorkspaceProps> = ({
  filteredImages,
  totalImages,
  children,
}) => {
  const images = useImageStore((state) => state.images);
  const collections = useImageStore((state) => state.collections);
  const activeCollectionId = useImageStore((state) => state.activeCollectionId);
  const setActiveCollectionId = useImageStore((state) => state.setActiveCollectionId);
  const createCollection = useImageStore((state) => state.createCollection);
  const updateCollection = useImageStore((state) => state.updateCollection);
  const deleteCollectionById = useImageStore((state) => state.deleteCollectionById);
  const reorderCollections = useImageStore((state) => state.reorderCollections);
  const getResolvedCollectionImages = useImageStore((state) => state.getResolvedCollectionImages);

  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<SmartCollection | null>(null);

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === activeCollectionId) ?? null,
    [activeCollectionId, collections],
  );

  const filteredCollections = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return collections;
    }

    return collections.filter((collection) => collection.name.toLowerCase().includes(normalizedQuery));
  }, [collections, searchQuery]);

  const selectedCollectionResolvedImages = useMemo(() => {
    if (!selectedCollection) {
      return [];
    }

    return getResolvedCollectionImages(selectedCollection.id);
  }, [getResolvedCollectionImages, selectedCollection]);

  const coverImage = useMemo(() => {
    if (!selectedCollection) {
      return null;
    }

    if (selectedCollection.coverImageId) {
      return images.find((image) => image.id === selectedCollection.coverImageId) ?? null;
    }

    return selectedCollectionResolvedImages[0] ?? null;
  }, [images, selectedCollection, selectedCollectionResolvedImages]);

  const moveCollection = async (collectionId: string, direction: -1 | 1) => {
    const currentIndex = collections.findIndex((collection) => collection.id === collectionId);
    const nextIndex = currentIndex + direction;
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= collections.length) {
      return;
    }

    const ordered = [...collections];
    const [movedCollection] = ordered.splice(currentIndex, 1);
    ordered.splice(nextIndex, 0, movedCollection);
    await reorderCollections(ordered.map((collection) => collection.id));
  };

  const handleCreateManualCollection = async (values: CollectionFormValues) => {
    await createCollection({
      kind: 'manual',
      name: values.name,
      description: values.description || undefined,
      sortIndex: collections.length,
      imageIds: [],
      snapshotImageIds: [],
      coverImageId: null,
      autoUpdate: false,
      sourceTag: null,
      thumbnailId: undefined,
      type: 'custom',
      query: undefined,
    });
    setIsCreateModalOpen(false);
  };

  const handleSaveCollection = async (values: CollectionFormValues) => {
    if (!editingCollection) {
      return;
    }

    const normalizedSourceTag = values.sourceTag.trim().toLowerCase();
    const hasAutoAddSettings = normalizedSourceTag.length > 0;
    const snapshotImageIds =
      hasAutoAddSettings && values.autoUpdate === false
        ? images
            .filter((image) => Array.isArray(image.tags) && image.tags.includes(normalizedSourceTag))
            .map((image) => image.id)
        : [];

    await updateCollection(editingCollection.id, {
      name: values.name,
      description: values.description || undefined,
      kind: hasAutoAddSettings ? 'tag_rule' : 'manual',
      sourceTag: hasAutoAddSettings ? normalizedSourceTag : null,
      autoUpdate: hasAutoAddSettings ? values.autoUpdate : false,
      snapshotImageIds,
    });
    setEditingCollection(null);
  };

  const handleDeleteCollection = async (collectionId: string) => {
    const confirmed = window.confirm('Delete this collection? This will not delete the underlying images.');
    if (!confirmed) {
      return;
    }

    await deleteCollectionById(collectionId);
  };

  return (
    <div className="flex h-full min-h-0 gap-4">
      <aside className="flex w-[320px] flex-shrink-0 flex-col rounded-2xl border border-gray-800 bg-gray-950/40">
        <div className="border-b border-gray-800 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Collections</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
            >
              <Plus className="h-4 w-4" />
              New
            </button>
          </div>

          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search collections..."
            className="mt-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {filteredCollections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/50 px-4 py-5 text-center text-sm text-gray-500">
              No collections yet.
            </div>
          ) : (
            filteredCollections.map((collection, index) => {
              const isActive = collection.id === selectedCollection?.id;
              return (
                <div
                  key={collection.id}
                  className={`rounded-xl border p-3 transition-colors ${
                    isActive
                      ? 'border-blue-500/50 bg-blue-500/10'
                      : 'border-gray-800 bg-gray-900/60 hover:border-gray-700 hover:bg-gray-900'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveCollectionId(collection.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-100">{collection.name}</div>
                        {collection.sourceTag && (
                          <div className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">
                            {collection.autoUpdate !== false
                              ? `Auto-add · ${collection.sourceTag}`
                              : `Tag link · ${collection.sourceTag}`}
                          </div>
                        )}
                      </div>
                      <span className="rounded-full border border-gray-700 bg-gray-950 px-2 py-0.5 text-[11px] text-gray-300">
                        {collection.imageCount}
                      </span>
                    </div>
                  </button>

                  <div className="mt-3 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => void moveCollection(collection.id, -1)}
                      disabled={index === 0}
                      className="rounded-md border border-gray-700 p-1.5 text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveCollection(collection.id, 1)}
                      disabled={index === collections.length - 1}
                      className="rounded-md border border-gray-700 p-1.5 text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingCollection(collection)}
                      className="rounded-md border border-gray-700 p-1.5 text-gray-300 transition-colors hover:bg-gray-800"
                      title="Collection settings"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteCollection(collection.id)}
                      className="rounded-md border border-red-900/40 p-1.5 text-red-300 transition-colors hover:bg-red-900/20"
                      title="Delete collection"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-gray-800 bg-gray-950/20">
        {selectedCollection ? (
          <>
            <div className="border-b border-gray-800 px-5 py-4">
              <div className="flex items-start gap-4">
                <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
                  {coverImage ? (
                    <img
                      src={coverImage.thumbnailUrl}
                      alt={selectedCollection.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-gray-600">
                      <FolderOpen className="h-6 w-6" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-white">{selectedCollection.name}</h2>
                    {selectedCollection.sourceTag && selectedCollection.autoUpdate !== false && (
                      <span className="rounded-full border border-emerald-600/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-emerald-300">
                        Auto
                      </span>
                    )}
                  </div>
                  {selectedCollection.description && (
                    <p className="mt-2 text-sm text-gray-300">{selectedCollection.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
                    <span>{totalImages.length} total in collection</span>
                    <span>{filteredImages.length} after current filters</span>
                    {selectedCollection.sourceTag && (
                      <span>Auto-add tag: {selectedCollection.sourceTag}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 p-4">{children}</div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-gray-400">
            <FolderOpen className="mb-4 h-10 w-10 text-gray-600" />
            <h3 className="text-base font-semibold text-gray-200">Choose a collection</h3>
          </div>
        )}
      </section>

      <CollectionFormModal
        isOpen={isCreateModalOpen}
        title="Create Collection"
        submitLabel="Create Collection"
        initialValues={{
          name: '',
          description: '',
          sourceTag: '',
          autoUpdate: false,
          includeTargetImages: false,
        }}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateManualCollection}
      />

      <CollectionFormModal
        isOpen={editingCollection !== null}
        title="Collection Settings"
        submitLabel="Save Changes"
        initialValues={{
          name: editingCollection?.name ?? '',
          description: editingCollection?.description ?? '',
          sourceTag: editingCollection?.sourceTag ?? '',
          autoUpdate: editingCollection?.autoUpdate ?? false,
          includeTargetImages: false,
        }}
        onClose={() => setEditingCollection(null)}
        onSubmit={handleSaveCollection}
        showSourceTag
        showAutoUpdate
      />
    </div>
  );
};

export default CollectionsWorkspace;
