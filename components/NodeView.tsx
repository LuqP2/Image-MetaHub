import React, { useEffect, useMemo, useState } from 'react';
import { Boxes, Search, X } from 'lucide-react';
import { IndexedImage } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';
import { useGenerationQueueStore } from '../store/useGenerationQueueStore';
import { buildWorkflowNodeCatalog, filterImagesByWorkflowNodes } from '../services/comfyUIWorkflowNodes';
import ImageGrid from './ImageGrid';
import ImageTable from './ImageTable';
import Footer from './Footer';

interface NodeViewProps {
  images: IndexedImage[];
  selectedImages: Set<string>;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  onBatchExport: () => void;
  isQueueOpen?: boolean;
  onToggleQueue?: () => void;
  onVisibleImagesChange?: (images: IndexedImage[]) => void;
}

const caseInsensitiveIncludes = (value: string, query: string) =>
  value.toLowerCase().includes(query.toLowerCase());

export const NodeView: React.FC<NodeViewProps> = ({
  images,
  selectedImages,
  onImageClick,
  onBatchExport,
  isQueueOpen = false,
  onToggleQueue,
  onVisibleImagesChange,
}) => {
  const selectionTotalImages = useImageStore((state) => state.selectionTotalImages);
  const selectionDirectoryCount = useImageStore((state) => state.selectionDirectoryCount);
  const enrichmentProgress = useImageStore((state) => state.enrichmentProgress);
  const { itemsPerPage, setItemsPerPage, viewMode, toggleViewMode } = useSettingsStore();
  const { progressState: a1111Progress } = useA1111ProgressContext();
  const queueCount = useGenerationQueueStore((state) =>
    state.items.filter((item) => item.status === 'waiting' || item.status === 'processing').length
  );

  const [page, setPage] = useState(1);
  const [nodeQuery, setNodeQuery] = useState('');
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);

  const nodeBearingImages = useMemo(
    () => images.filter((image) => (image.workflowNodes?.length || 0) > 0),
    [images]
  );

  const nodeCatalog = useMemo(
    () => buildWorkflowNodeCatalog(nodeBearingImages),
    [nodeBearingImages]
  );

  const filteredNodeCatalog = useMemo(() => {
    const query = nodeQuery.trim().toLowerCase();
    if (!query) {
      return nodeCatalog;
    }

    return nodeCatalog.filter((entry) => caseInsensitiveIncludes(entry.name, query));
  }, [nodeCatalog, nodeQuery]);

  const resultImages = useMemo(
    () => filterImagesByWorkflowNodes(nodeBearingImages, selectedNodes),
    [nodeBearingImages, selectedNodes]
  );

  const totalPages = itemsPerPage === -1 ? 1 : Math.max(1, Math.ceil(resultImages.length / itemsPerPage));

  const paginatedImages = useMemo(() => {
    if (itemsPerPage === -1) {
      return resultImages;
    }

    const start = (page - 1) * itemsPerPage;
    return resultImages.slice(start, start + itemsPerPage);
  }, [itemsPerPage, page, resultImages]);

  useEffect(() => {
    setPage(1);
  }, [itemsPerPage, nodeQuery, selectedNodes]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    onVisibleImagesChange?.(paginatedImages);
  }, [onVisibleImagesChange, paginatedImages]);

  const toggleNode = (nodeName: string) => {
    setSelectedNodes((current) =>
      current.includes(nodeName)
        ? current.filter((entry) => entry !== nodeName)
        : [...current, nodeName]
    );
  };

  const removeSelectedNode = (nodeName: string) => {
    setSelectedNodes((current) => current.filter((entry) => entry !== nodeName));
  };

  const clearSelection = () => {
    setSelectedNodes([]);
    setNodeQuery('');
  };

  const summaryText =
    selectedNodes.length > 0
      ? `Showing ${resultImages.length} image${resultImages.length !== 1 ? 's' : ''} across ${selectedNodes.length} selected node${selectedNodes.length !== 1 ? 's' : ''}`
      : `Showing ${resultImages.length} ComfyUI image${resultImages.length !== 1 ? 's' : ''} across ${nodeCatalog.length} node types`;

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid min-h-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                <Boxes className="h-3.5 w-3.5" />
                Node View
              </div>
              <h2 className="mt-3 text-lg font-semibold text-gray-100">ComfyUI nodes in the current scope</h2>
              <p className="mt-1 text-sm text-gray-400">
                Search exact node types and combine multiple selections with OR logic.
              </p>
            </div>
            {(selectedNodes.length > 0 || nodeQuery) && (
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-lg border border-gray-700 bg-gray-800/80 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:border-gray-600 hover:bg-gray-700"
              >
                Clear
              </button>
            )}
          </div>

          <label className="mt-4 flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-950/70 px-3 py-2.5">
            <Search className="h-4 w-4 text-gray-500" />
            <input
              value={nodeQuery}
              onChange={(event) => setNodeQuery(event.target.value)}
              placeholder="Search nodes..."
              className="w-full bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-500"
            />
          </label>

          <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/50 p-3 text-xs text-gray-400">
            <div className="flex items-center justify-between">
              <span>Node-bearing images</span>
              <span className="font-semibold text-gray-200">{nodeBearingImages.length}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span>Available node types</span>
              <span className="font-semibold text-gray-200">{nodeCatalog.length}</span>
            </div>
          </div>

          {selectedNodes.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Selected nodes</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedNodes.map((nodeName) => (
                  <button
                    key={nodeName}
                    type="button"
                    onClick={() => removeSelectedNode(nodeName)}
                    className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100 transition-colors hover:bg-cyan-500/20"
                  >
                    {nodeName}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Node catalog</div>
              <div className="text-xs text-gray-500">
                {filteredNodeCatalog.length} / {nodeCatalog.length}
              </div>
            </div>

            <div className="max-h-[540px] space-y-2 overflow-y-auto pr-1">
              {filteredNodeCatalog.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-700 bg-gray-950/40 px-4 py-6 text-center text-sm text-gray-500">
                  No nodes match the current search.
                </div>
              ) : (
                filteredNodeCatalog.map((entry) => {
                  const active = selectedNodes.includes(entry.name);
                  return (
                    <button
                      key={entry.name}
                      type="button"
                      onClick={() => toggleNode(entry.name)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                        active
                          ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                          : 'border-gray-800 bg-gray-950/40 text-gray-200 hover:border-gray-700 hover:bg-gray-900/80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="break-all text-sm font-medium">{entry.name}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            {entry.count} image{entry.count !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <div
                          className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                            active ? 'bg-cyan-500/20 text-cyan-100' : 'bg-gray-800 text-gray-300'
                          }`}
                        >
                          {active ? 'Selected' : 'Add'}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 flex-col rounded-2xl border border-gray-800 bg-gray-900/60 p-4 shadow-lg">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-100">Matching images</h3>
              <p className="mt-1 text-sm text-gray-400">{summaryText}</p>
            </div>
            {selectedNodes.length > 0 && (
              <div className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-100">
                OR match across selected nodes
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {nodeBearingImages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-700 bg-gray-950/30 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-800/70 text-gray-300">
                  <Boxes className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-gray-100">No embedded ComfyUI workflow nodes found</h3>
                <p className="mt-2 max-w-xl text-sm text-gray-400">
                  Node View only works for images that contain embedded ComfyUI workflow metadata.
                </p>
              </div>
            ) : resultImages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-700 bg-gray-950/30 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-800/70 text-gray-300">
                  <Search className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-gray-100">No images match the selected nodes</h3>
                <p className="mt-2 max-w-xl text-sm text-gray-400">
                  Adjust the node selection or clear the current filter to browse all ComfyUI images in scope.
                </p>
              </div>
            ) : viewMode === 'grid' ? (
              <ImageGrid
                images={paginatedImages}
                onImageClick={onImageClick}
                selectedImages={selectedImages}
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
                onBatchExport={onBatchExport}
              />
            ) : (
              <ImageTable
                images={paginatedImages}
                onImageClick={onImageClick}
                selectedImages={selectedImages}
                onBatchExport={onBatchExport}
              />
            )}
          </div>
        </div>
      </div>

      <Footer
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        itemsPerPage={itemsPerPage}
        onItemsPerPageChange={setItemsPerPage}
        viewMode={viewMode}
        onViewModeChange={toggleViewMode}
        customText={summaryText}
        filteredCount={resultImages.length}
        totalCount={selectionTotalImages}
        directoryCount={selectionDirectoryCount}
        enrichmentProgress={enrichmentProgress}
        a1111Progress={a1111Progress}
        queueCount={queueCount}
        isQueueOpen={isQueueOpen}
        onToggleQueue={onToggleQueue}
      />
    </section>
  );
};

export default NodeView;
