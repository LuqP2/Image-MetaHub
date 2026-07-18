import React, { useEffect, useMemo, useState } from 'react';
import { Box, FolderOpen, Layers, Lock, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import type { ExploreDimension, IndexedImage, SmartCollection } from '../types';
import { limitClustersForAccess } from '../utils/smartLibraryClusterState';
import ScopeCard from './ScopeCard';
import CollectionFormModal, { type CollectionFormValues } from './CollectionFormModal';
import AutomationRulesModal from './AutomationRulesModal';
import { buildCollectionSettingsUpdate } from './CollectionsWorkspace';

const DEFAULT_SIMILARITY_THRESHOLD = 0.88;
const GRID_CLASS = 'grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5';

interface ExploreWorkspaceProps {
  /** Navigate to the Library grid after a card sets the active scope. */
  onNavigateToLibrary: () => void;
}

const DIMENSIONS: { id: ExploreDimension; label: string; icon: typeof Box }[] = [
  { id: 'models', label: 'Models', icon: Box },
  { id: 'clusters', label: 'Clusters', icon: Layers },
  { id: 'collections', label: 'Collections', icon: FolderOpen },
];

const ExploreWorkspace: React.FC<ExploreWorkspaceProps> = ({ onNavigateToLibrary }) => {
  const images = useImageStore((state) => state.images);
  const clusters = useImageStore((state) => state.clusters);
  const collections = useImageStore((state) => state.collections);
  const directories = useImageStore((state) => state.directories);
  // Scan mode: use the same source the loader / clustering / cache-restore use (useImageStore),
  // not useSettingsStore, so the cluster cache saves and restores under the same key.
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const clusteringMetadata = useImageStore((state) => state.clusteringMetadata);
  const isClustering = useImageStore((state) => state.isClustering);
  const clusteringProgress = useImageStore((state) => state.clusteringProgress);
  const activeImageScope = useImageStore((state) => state.activeImageScope);
  const exploreDimension = useImageStore((state) => state.exploreDimension);
  const setExploreDimension = useImageStore((state) => state.setExploreDimension);
  const setActiveImageScope = useImageStore((state) => state.setActiveImageScope);
  const startClustering = useImageStore((state) => state.startClustering);
  const getResolvedCollectionImages = useImageStore((state) => state.getResolvedCollectionImages);
  const createCollection = useImageStore((state) => state.createCollection);
  const updateCollection = useImageStore((state) => state.updateCollection);
  const deleteCollectionById = useImageStore((state) => state.deleteCollectionById);

  const itemsPerPage = useSettingsStore((state) => state.itemsPerPage);
  const { canUseFullClustering, showProModal } = useFeatureAccess();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<SmartCollection | null>(null);
  const [automationRuleCollection, setAutomationRuleCollection] = useState<SmartCollection | null>(null);
  const [page, setPage] = useState(1);

  // Reset paging when the dimension changes so a deep page from one dimension doesn't leak.
  useEffect(() => {
    setPage(1);
  }, [exploreDimension]);

  const paginate = <T,>(items: T[]): T[] =>
    itemsPerPage === -1 ? items : items.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const primaryPath = directories[0]?.path ?? '';
  const hasDirectories = directories.length > 0;

  const scopeToLibrary = (scope: Parameters<typeof setActiveImageScope>[0]) => {
    setActiveImageScope(scope);
    onNavigateToLibrary();
  };

  // --- Models ---
  const modelEntries = useMemo(() => {
    const models = new Map<string, IndexedImage[]>();
    for (const image of images) {
      if (!image.models?.length) continue;
      for (const modelName of image.models) {
        if (!modelName) continue;
        const bucket = models.get(modelName);
        if (bucket) {
          bucket.push(image);
        } else {
          models.set(modelName, [image]);
        }
      }
    }
    return Array.from(models.entries())
      .map(([name, modelImages]) => ({ name, images: modelImages, count: modelImages.length }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [images]);

  // --- Clusters ---
  const visibleClusters = useMemo(
    () => limitClustersForAccess(clusters, images, canUseFullClustering),
    [canUseFullClustering, clusters, images],
  );

  const clusterEntries = useMemo(() => {
    const imageMap = new Map<string, IndexedImage>();
    for (const image of images) {
      imageMap.set(image.id, image);
    }
    const lockedImageIds = clusteringMetadata?.lockedImageIds ?? new Set<string>();
    return visibleClusters
      .map((cluster) => {
        const clusterImages = cluster.imageIds
          .map((id) => imageMap.get(id))
          .filter((image): image is IndexedImage => Boolean(image));
        const lockedCount = clusterImages.filter((image) => lockedImageIds.has(image.id)).length;
        const isLocked = clusterImages.length > 0 && lockedCount / clusterImages.length > 0.5;
        return { cluster, images: clusterImages, isLocked };
      })
      .filter((entry) => entry.images.length >= 3)
      .sort((a, b) => b.images.length - a.images.length);
  }, [clusteringMetadata, images, visibleClusters]);

  // --- Collections ---
  const collectionEntries = useMemo(() => {
    const imageById = new Map<string, IndexedImage>();
    for (const image of images) {
      imageById.set(image.id, image);
    }
    return collections.map((collection) => {
      const resolvedImages = getResolvedCollectionImages(collection.id);
      const explicitCover = collection.coverImageId ? imageById.get(collection.coverImageId) ?? null : null;
      const orderedImages = explicitCover
        ? [explicitCover, ...resolvedImages.filter((image) => image.id !== explicitCover.id)]
        : resolvedImages;
      return { collection, images: orderedImages, count: resolvedImages.length };
    });
  }, [collections, getResolvedCollectionImages, images]);

  const handleGenerateClusters = () => {
    if (!hasDirectories || isClustering) return;
    startClustering(primaryPath, scanSubfolders, DEFAULT_SIMILARITY_THRESHOLD);
  };

  const handleCreateCollection = async (values: CollectionFormValues) => {
    const collection = await createCollection({
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
    // Offer to configure automation rules for the freshly created collection.
    if (values.configureAutomationRules) {
      setAutomationRuleCollection(collection);
    }
  };

  const handleSaveCollection = async (values: CollectionFormValues) => {
    if (!editingCollection) {
      return;
    }
    await updateCollection(
      editingCollection.id,
      buildCollectionSettingsUpdate({ collection: editingCollection, values, images }),
    );
    setEditingCollection(null);
  };

  const handleDeleteCollection = async (collection: SmartCollection) => {
    const confirmed = window.confirm(
      `Delete the collection "${collection.name}"? This does not delete the underlying images.`,
    );
    if (!confirmed) {
      return;
    }
    await deleteCollectionById(collection.id);
  };

  // Pagination keeps large libraries from mounting thousands of cards (and their thumbnail/scrub
  // hooks) at once — matches the old Smart Library behavior.
  const activeEntriesCount =
    exploreDimension === 'models'
      ? modelEntries.length
      : exploreDimension === 'clusters'
      ? clusterEntries.length
      : collectionEntries.length;
  const totalPages = itemsPerPage === -1 ? 1 : Math.max(1, Math.ceil(activeEntriesCount / itemsPerPage));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Dimension selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-6 py-4">
        <div className="inline-flex rounded-xl border border-gray-800 bg-gray-900/60 p-1">
          {DIMENSIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setExploreDimension(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                exploreDimension === id
                  ? 'bg-blue-500/20 text-blue-200'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              aria-pressed={exploreDimension === id}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {exploreDimension === 'clusters' && (
          <button
            type="button"
            onClick={handleGenerateClusters}
            disabled={!hasDirectories || isClustering}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 transition-colors hover:border-blue-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {isClustering ? 'Clustering…' : 'Generate clusters'}
          </button>
        )}

        {exploreDimension === 'collections' && (
          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 transition-colors hover:border-blue-500/40 hover:text-white"
          >
            <FolderOpen className="h-4 w-4" />
            New collection
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {exploreDimension === 'models' &&
          (modelEntries.length === 0 ? (
            <EmptyState
              icon={Box}
              title="No models yet"
              description="Index a library with generation metadata to browse checkpoints here."
            />
          ) : (
            <div className={GRID_CLASS}>
              {paginate(modelEntries).map((entry) => (
                <ScopeCard
                  key={entry.name}
                  images={entry.images}
                  icon={Box}
                  coverAlt={entry.name}
                  countLabel={entry.count}
                  title={entry.name}
                  isActive={activeImageScope?.type === 'model' && activeImageScope.id === entry.name}
                  onClick={() => scopeToLibrary({ type: 'model', id: entry.name, label: entry.name })}
                  subtitle={
                    <p className="mt-1 text-xs text-gray-400">
                      {entry.count} image{entry.count !== 1 ? 's' : ''}
                    </p>
                  }
                />
              ))}
            </div>
          ))}

        {exploreDimension === 'clusters' && isClustering && (
          <ProgressBar
            label={clusteringProgress?.message ?? 'Clustering…'}
            current={clusteringProgress?.current ?? 0}
            total={clusteringProgress?.total ?? 0}
          />
        )}

        {exploreDimension === 'clusters' &&
          (clusterEntries.length === 0 ? (
            isClustering ? null : (
            <EmptyState
              icon={Layers}
              title="No clusters yet"
              description="Group visually similar images into stacks to explore them together."
              action={
                <button
                  type="button"
                  onClick={handleGenerateClusters}
                  disabled={!hasDirectories || isClustering}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-100 transition-colors hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  Generate clusters
                </button>
              }
            />
            )
          ) : (
            <div className={GRID_CLASS}>
              {paginate(clusterEntries).map(({ cluster, images: clusterImages, isLocked }) => {
                const label = cluster.basePrompt || 'Untitled stack';
                return (
                  <ScopeCard
                    key={cluster.id}
                    images={clusterImages}
                    icon={Layers}
                    coverAlt={label}
                    countLabel={clusterImages.length}
                    title={label}
                    coverBlur={isLocked}
                    disableScrub={isLocked}
                    isActive={activeImageScope?.type === 'cluster' && activeImageScope.id === cluster.id}
                    variantClassName={
                      isLocked
                        ? 'border-purple-500/40 hover:shadow-xl hover:shadow-purple-500/30'
                        : undefined
                    }
                    overlay={
                      isLocked ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <div className="flex flex-col items-center gap-2 text-purple-300">
                            <Lock className="h-12 w-12" />
                            <span className="text-sm font-semibold">Pro Only</span>
                          </div>
                        </div>
                      ) : undefined
                    }
                    onClick={() =>
                      isLocked
                        ? showProModal('clustering')
                        : scopeToLibrary({ type: 'cluster', id: cluster.id, label })
                    }
                    subtitle={
                      <p className="mt-1 text-xs text-gray-400">
                        {clusterImages.length} images | similarity{' '}
                        {Math.round(cluster.similarityThreshold * 100)}%
                      </p>
                    }
                  />
                );
              })}
            </div>
          ))}

        {exploreDimension === 'collections' &&
          (collectionEntries.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No collections yet"
              description="Create a collection to group images manually or by a tag rule."
              action={
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-100 transition-colors hover:bg-blue-500/30"
                >
                  <FolderOpen className="h-4 w-4" />
                  New collection
                </button>
              }
            />
          ) : (
            <div className={GRID_CLASS}>
              {paginate(collectionEntries).map(({ collection, images: previewImages, count }) => (
                <ScopeCard
                  key={collection.id}
                  images={previewImages}
                  icon={FolderOpen}
                  coverAlt={collection.name}
                  countLabel={count}
                  title={collection.name}
                  ariaLabel={`Open collection ${collection.name}`}
                  contentClassName="p-4"
                  isActive={activeImageScope?.type === 'collection' && activeImageScope.id === collection.id}
                  onClick={() => scopeToLibrary({ type: 'collection', id: collection.id, label: collection.name })}
                  badge={
                    collection.sourceTag ? (
                      <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
                        <Sparkles className="h-3.5 w-3.5" />
                        {collection.autoUpdate !== false ? 'Auto' : 'Linked'}
                      </div>
                    ) : undefined
                  }
                  subtitle={
                    <>
                      {collection.description?.trim() ? (
                        <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs text-gray-400">
                          {collection.description}
                        </p>
                      ) : (
                        <p className="mt-1 min-h-[2.5rem] text-xs text-gray-500">
                          {count} image{count !== 1 ? 's' : ''}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-1">
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={`Edit collection ${collection.name}`}
                          title="Edit collection"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditingCollection(collection);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              setEditingCollection(collection);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-gray-100"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </div>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={`Delete collection ${collection.name}`}
                          title="Delete collection"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteCollection(collection);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleDeleteCollection(collection);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-gray-400 transition-colors hover:bg-rose-900/40 hover:text-rose-200"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </div>
                      </div>
                    </>
                  }
                />
              ))}
            </div>
          ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 border-t border-gray-800 px-6 py-3 text-sm">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-gray-700 px-3 py-1.5 font-medium text-gray-200 transition-colors hover:border-blue-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-gray-400">
            Page <span className="font-semibold text-gray-200">{page}</span> of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-gray-700 px-3 py-1.5 font-medium text-gray-200 transition-colors hover:border-blue-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      <CollectionFormModal
        isOpen={isCreateModalOpen}
        title="New collection"
        submitLabel="Create"
        initialValues={{
          name: '',
          description: '',
          sourceTag: '',
          autoUpdate: false,
          includeTargetImages: false,
        }}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateCollection}
        showAutomationRulesOption
      />

      <CollectionFormModal
        isOpen={editingCollection !== null}
        title="Collection settings"
        submitLabel="Save changes"
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

      <AutomationRulesModal
        isOpen={automationRuleCollection !== null}
        onClose={() => setAutomationRuleCollection(null)}
        initialCollectionId={automationRuleCollection?.id ?? null}
        initialRuleName={automationRuleCollection ? `Add to ${automationRuleCollection.name}` : undefined}
      />
    </div>
  );
};

const ProgressBar: React.FC<{ label: string; current: number; total: number }> = ({ label, current, total }) => {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="truncate text-gray-200">{label}</span>
        <span className="shrink-0 text-xs text-gray-500">
          {total > 0 ? `${current}/${total} (${pct}%)` : '…'}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
        <div
          className={`h-full bg-blue-500 transition-all duration-200 ${total > 0 ? '' : 'animate-pulse'}`}
          style={{ width: total > 0 ? `${pct}%` : '100%' }}
        />
      </div>
    </div>
  );
};

interface EmptyStateProps {
  icon: typeof Box;
  title: string;
  description: string;
  action?: React.ReactNode;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, description, action }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-800/60 text-gray-500">
      <Icon className="h-8 w-8" />
    </div>
    <h3 className="text-lg font-semibold text-gray-200">{title}</h3>
    <p className="max-w-md text-sm text-gray-400">{description}</p>
    {action && <div className="mt-2">{action}</div>}
  </div>
);

export default ExploreWorkspace;
