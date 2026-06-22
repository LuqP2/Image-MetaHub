import React from 'react';
import { Boxes } from 'lucide-react';
import {
  type VisualWorkflowGraph,
} from '../services/comfyUIVisualWorkflow';
import { renderWorkflowFieldControl } from './ComfyUIWorkflowVisualEditor';

interface ComfyUIWorkflowNodeListProps {
  graph: VisualWorkflowGraph | null;
  fieldOptions?: Record<string, Array<string | number | boolean>>;
  onFieldChange: (nodeId: string, inputKey: string, value: string | number | boolean) => void;
}

const CATEGORY_STYLES: Record<string, string> = {
  prompt: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
  sampler: 'border-blue-500/40 bg-blue-500/10 text-blue-100',
  model: 'border-violet-500/40 bg-violet-500/10 text-violet-100',
  lora: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-100',
  image: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
  mask: 'border-orange-500/40 bg-orange-500/10 text-orange-100',
  save: 'border-teal-500/40 bg-teal-500/10 text-teal-100',
  timer: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100',
  generic: 'border-gray-600 bg-gray-800 text-gray-200',
};

const ComfyUIWorkflowNodeList: React.FC<ComfyUIWorkflowNodeListProps> = ({
  graph,
  fieldOptions,
  onFieldChange,
}) => {
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-6 text-sm text-gray-400">
        Node details are unavailable because this image does not contain an executable ComfyUI workflow.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-900/60 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-gray-100">Workflow Nodes</div>
          <div className="text-xs text-gray-400">
            {graph.nodes.length} nodes in execution order. Safe literal parameters can be edited here.
          </div>
        </div>
        <Boxes size={18} className="text-purple-300" />
      </div>

      {graph.nodes
        .slice()
        .sort((left, right) => left.order - right.order)
        .map((node) => (
          <section key={node.id} className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-100">{node.label}</span>
                  <span className="text-xs text-gray-500">#{node.id}</span>
                </div>
                <div className="mt-1 text-xs text-gray-400">{node.classType}</div>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${
                  CATEGORY_STYLES[node.category] || CATEGORY_STYLES.generic
                }`}
              >
                {node.category}
              </span>
            </div>

            {node.fields.length > 0 ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {node.fields.map((field) => (
                  <label key={field.key} className="block space-y-1.5">
                    <span className="text-sm font-medium text-gray-300">{field.label}</span>
                    {renderWorkflowFieldControl(
                      field,
                      fieldOptions?.[`${node.id}:${field.key}`],
                      (value) => onFieldChange(node.id, field.key, value)
                    )}
                  </label>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-gray-700 bg-gray-950/40 px-3 py-2 text-xs text-gray-500">
                No safe literal parameters are exposed for this node.
              </div>
            )}
          </section>
        ))}
    </div>
  );
};

export default ComfyUIWorkflowNodeList;
