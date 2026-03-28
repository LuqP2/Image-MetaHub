import React, { useMemo } from 'react';
import { Eye, Move, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import {
  type VisualWorkflowField,
  type VisualWorkflowGraph,
  type VisualWorkflowNode,
} from '../services/comfyUIVisualWorkflow';

interface ComfyUIWorkflowVisualEditorProps {
  graph: VisualWorkflowGraph | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onFieldChange: (nodeId: string, inputKey: string, value: string | number | boolean) => void;
}

const CATEGORY_STYLES: Record<VisualWorkflowNode['category'], { card: string; badge: string }> = {
  prompt: {
    card: 'border-emerald-500/40 bg-emerald-500/10',
    badge: 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100',
  },
  sampler: {
    card: 'border-blue-500/40 bg-blue-500/10',
    badge: 'border-blue-400/40 bg-blue-500/20 text-blue-100',
  },
  model: {
    card: 'border-violet-500/40 bg-violet-500/10',
    badge: 'border-violet-400/40 bg-violet-500/20 text-violet-100',
  },
  lora: {
    card: 'border-fuchsia-500/40 bg-fuchsia-500/10',
    badge: 'border-fuchsia-400/40 bg-fuchsia-500/20 text-fuchsia-100',
  },
  image: {
    card: 'border-amber-500/40 bg-amber-500/10',
    badge: 'border-amber-400/40 bg-amber-500/20 text-amber-100',
  },
  mask: {
    card: 'border-orange-500/40 bg-orange-500/10',
    badge: 'border-orange-400/40 bg-orange-500/20 text-orange-100',
  },
  save: {
    card: 'border-teal-500/40 bg-teal-500/10',
    badge: 'border-teal-400/40 bg-teal-500/20 text-teal-100',
  },
  timer: {
    card: 'border-cyan-500/40 bg-cyan-500/10',
    badge: 'border-cyan-400/40 bg-cyan-500/20 text-cyan-100',
  },
  generic: {
    card: 'border-gray-700 bg-gray-900/80',
    badge: 'border-gray-600 bg-gray-700/70 text-gray-200',
  },
};

const LONG_TEXT_KEYS = new Set(['text', 'prompt', 'positive', 'negative', 'positive_prompt', 'negative_prompt']);

function renderFieldControl(
  field: VisualWorkflowField,
  onChange: (value: string | number | boolean) => void
): React.ReactNode {
  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 rounded border border-gray-700 bg-gray-950/70 px-3 py-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={Boolean(field.value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.type === 'number') {
    return (
      <input
        type="number"
        step="any"
        value={typeof field.value === 'number' ? field.value : Number(field.value) || 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
    );
  }

  const stringValue = String(field.value ?? '');
  const isLongText = LONG_TEXT_KEYS.has(field.key) || stringValue.length > 80 || stringValue.includes('\n');
  if (isLongText) {
    return (
      <textarea
        rows={Math.min(8, Math.max(3, Math.ceil(stringValue.length / 64)))}
        value={stringValue}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
    );
  }

  return (
    <input
      type="text"
      value={stringValue}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
    />
  );
}

export const ComfyUIWorkflowVisualEditor: React.FC<ComfyUIWorkflowVisualEditorProps> = ({
  graph,
  selectedNodeId,
  onSelectNode,
  onFieldChange,
}) => {
  const scene = useMemo(() => {
    if (!graph || graph.nodes.length === 0) {
      return null;
    }

    const minX = Math.min(...graph.nodes.map((node) => node.x));
    const minY = Math.min(...graph.nodes.map((node) => node.y));
    const normalizedNodes = graph.nodes.map((node) => ({
      ...node,
      x: node.x - minX + 80,
      y: node.y - minY + 60,
    }));
    const width = Math.max(...normalizedNodes.map((node) => node.x + node.width)) + 120;
    const height = Math.max(...normalizedNodes.map((node) => node.y + node.height)) + 120;
    const nodeMap = new Map(normalizedNodes.map((node) => [node.id, node]));

    return {
      width,
      height,
      nodes: normalizedNodes,
      nodeMap,
    };
  }, [graph]);

  const selectedNode = scene?.nodeMap.get(selectedNodeId || '') || scene?.nodes[0] || null;

  if (!graph || !scene) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-6 text-sm text-gray-400">
        Visual workflow is unavailable for this image.
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-lg border border-gray-700 bg-gray-900/60 overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-100">Workflow Overview</div>
            <div className="text-xs text-gray-400">
              {graph.nodes.length} nodes, {graph.edges.length} connections
              {graph.hasStoredLayout ? ' • using embedded layout' : ' • using auto-layout'}
            </div>
          </div>
          <div className="rounded-full border border-gray-700 bg-gray-800/80 px-3 py-1 text-[11px] text-gray-300">
            <span className="inline-flex items-center gap-1">
              <Move size={12} />
              Pan and zoom enabled
            </span>
          </div>
        </div>

        <div className="relative h-[560px] bg-[radial-gradient(circle_at_center,rgba(148,163,184,0.08),transparent_55%)]">
          <TransformWrapper
            minScale={0.35}
            maxScale={2.5}
            centerOnInit
            initialScale={graph.nodes.length > 10 ? 0.7 : 0.95}
            wheel={{ step: 0.1 }}
          >
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <TransformComponent
                  wrapperClass="!w-full !h-full"
                  contentClass="!w-full !h-full"
                  wrapperStyle={{ width: '100%', height: '100%' }}
                  contentStyle={{ width: '100%', height: '100%' }}
                >
                  <div className="relative h-full w-full">
                    <div
                      className="relative"
                      style={{
                        width: `${scene.width}px`,
                        height: `${scene.height}px`,
                      }}
                    >
                      <svg
                        className="absolute left-0 top-0 h-full w-full pointer-events-none"
                        viewBox={`0 0 ${scene.width} ${scene.height}`}
                        preserveAspectRatio="none"
                      >
                        {graph.edges.map((edge) => {
                          const fromNode = scene.nodeMap.get(edge.from);
                          const toNode = scene.nodeMap.get(edge.to);
                          if (!fromNode || !toNode) {
                            return null;
                          }

                          const startX = fromNode.x + fromNode.width;
                          const startY = fromNode.y + fromNode.height / 2;
                          const endX = toNode.x;
                          const endY = toNode.y + 42;
                          const controlOffset = Math.max(60, (endX - startX) * 0.45);
                          const path = `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;
                          return (
                            <g key={`${edge.from}-${edge.to}-${edge.label}`}>
                              <path d={path} fill="none" stroke="rgba(148,163,184,0.45)" strokeWidth="2" />
                              {edge.label && (
                                <text
                                  x={(startX + endX) / 2}
                                  y={(startY + endY) / 2 - 6}
                                  textAnchor="middle"
                                  className="fill-gray-400 text-[10px]"
                                >
                                  {edge.label}
                                </text>
                              )}
                            </g>
                          );
                        })}
                      </svg>

                      {scene.nodes.map((node) => {
                        const styles = CATEGORY_STYLES[node.category];
                        const isSelected = node.id === selectedNode?.id;
                        return (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => onSelectNode(node.id)}
                            className={`absolute rounded-xl border p-3 text-left shadow-lg transition-all ${styles.card} ${
                              isSelected ? 'ring-2 ring-purple-400 shadow-purple-500/30' : 'hover:border-gray-500'
                            }`}
                            style={{
                              left: `${node.x}px`,
                              top: `${node.y}px`,
                              width: `${node.width}px`,
                              minHeight: `${node.height}px`,
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold text-gray-100">{node.label}</div>
                                <div className="mt-1 text-[11px] text-gray-400">{node.classType}</div>
                              </div>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${styles.badge}`}>
                                {node.category}
                              </span>
                            </div>
                            <div className="mt-3 space-y-2">
                              {node.fields.length > 0 ? (
                                node.fields.slice(0, 3).map((field) => (
                                  <div key={field.key} className="rounded-md border border-white/5 bg-black/20 px-2 py-1.5">
                                    <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">{field.label}</div>
                                    <div className="mt-1 truncate text-xs text-gray-100">
                                      {typeof field.value === 'boolean' ? (field.value ? 'True' : 'False') : String(field.value)}
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="rounded-md border border-dashed border-gray-700 px-2 py-3 text-xs text-gray-500">
                                  No safe literal fields exposed here.
                                </div>
                              )}
                              {node.fields.length > 3 && (
                                <div className="text-[11px] text-gray-400">+{node.fields.length - 3} more editable fields</div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </TransformComponent>

                <div className="absolute right-3 top-3 z-10 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => zoomIn()}
                    className="rounded-lg border border-gray-700 bg-gray-900/80 p-2 text-gray-200 transition-colors hover:bg-gray-800"
                    title="Zoom in"
                  >
                    <ZoomIn size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => zoomOut()}
                    className="rounded-lg border border-gray-700 bg-gray-900/80 p-2 text-gray-200 transition-colors hover:bg-gray-800"
                    title="Zoom out"
                  >
                    <ZoomOut size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => resetTransform()}
                    className="rounded-lg border border-gray-700 bg-gray-900/80 p-2 text-gray-200 transition-colors hover:bg-gray-800"
                    title="Reset view"
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
              </>
            )}
          </TransformWrapper>
        </div>
      </div>

      <aside className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
        {selectedNode ? (
          <div className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Inspector</div>
              <div className="mt-1 text-lg font-semibold text-gray-100">{selectedNode.label}</div>
              <div className="mt-1 text-xs text-gray-400">{selectedNode.classType}</div>
            </div>

            <div className="rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-xs text-gray-300">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Category</span>
                <span className="uppercase tracking-[0.18em] text-gray-100">{selectedNode.category}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-gray-500">Editable fields</span>
                <span className="text-gray-100">{selectedNode.fields.length}</span>
              </div>
            </div>

            {selectedNode.fields.length > 0 ? (
              <div className="space-y-3">
                {selectedNode.fields.map((field) => (
                  <label key={field.key} className="block space-y-1.5">
                    <span className="text-sm font-medium text-gray-300">{field.label}</span>
                    {renderFieldControl(field, (value) => onFieldChange(selectedNode.id, field.key, value))}
                  </label>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-700 bg-gray-950/40 p-4 text-sm text-gray-400">
                This node is shown for context, but the app is not exposing editable literal inputs for it in v1.
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-[260px] items-center justify-center rounded-lg border border-dashed border-gray-700 bg-gray-950/40 p-6 text-center text-sm text-gray-400">
            <div>
              <Eye className="mx-auto mb-3 text-gray-500" size={22} />
              Select a node to inspect and edit its safe literal inputs.
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};

export default ComfyUIWorkflowVisualEditor;
