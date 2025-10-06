import { ComfyUIMetadata, BaseMetadata, ComfyUIWorkflow, ComfyUIPrompt, ComfyUINode } from '../../types';
import { Graph, GraphNode, resolve, resolveAll } from './comfyui/traversalEngine';
import { NodeRegistry } from './comfyui/nodeRegistry';

function createNodeMap(workflow: ComfyUIWorkflow | null, prompt: ComfyUIPrompt): Graph {
    const graph: Graph = {};
    const nodeDefs: { [id: string]: ComfyUINode } = {};

    // 1. First pass: Create all node entries from the workflow definition
    if (workflow?.nodes) {
        for (const node of workflow.nodes) {
            const nodeId = node.id.toString();
            nodeDefs[nodeId] = node;
            graph[nodeId] = {
                id: nodeId,
                inputs: {}, // Inputs will be populated next
                class_type: node.type,
                widgets_values: node.widgets_values,
                // Add widgets for param_mapping rules that use source: 'widget'
                ...((node as any).widgets) && { widgets: (node as any).widgets },
            };
        }
    }

    // 2. Second pass: Populate inputs based on the workflow's links array.
    if (workflow?.links) {
        for (const link of workflow.links) {
            const [_linkId, sourceNodeId, sourceOutputSlot, targetNodeId, targetInputSlot] = link;
            const targetNodeDef = nodeDefs[targetNodeId.toString()];
            const targetNode = graph[targetNodeId.toString()];

            if (targetNode && targetNodeDef && targetNodeDef.inputs) {
                const inputInfo = targetNodeDef.inputs[targetInputSlot];
                if (inputInfo) {
                    targetNode.inputs[inputInfo.name] = [sourceNodeId.toString(), sourceOutputSlot];
                }
            }
        }
    }

    // 3. Final pass: Overlay with prompt data. This is the source of truth for execution.
    for (const [id, promptNode] of Object.entries(prompt)) {
        if (!graph[id]) {
            graph[id] = {
                id,
                inputs: promptNode.inputs,
                class_type: promptNode.class_type,
            };
        } else {
            graph[id].inputs = promptNode.inputs;
            graph[id].class_type = promptNode.class_type;
        }
    }

    return graph;
}

/**
 * Finds the terminal node in a ComfyUI graph for initiating backward traversal.
 * It prioritizes nodes based on their semantic role defined in the NodeRegistry.
 * @param graph The graph to search.
 * @returns The identified terminal GraphNode or null.
 */
function findTerminalNode(graph: Graph): GraphNode | null {
    const allOutputNodes = new Set<string>();
    Object.values(graph).forEach(node => {
        Object.values(node.inputs).forEach(input => {
            if (Array.isArray(input) && typeof input[0] === 'string') {
                allOutputNodes.add(input[0]);
            }
        });
    });

    const sinkNodes = Object.values(graph).filter(node => {
        const def = NodeRegistry[node.class_type];
        // It's a sink if it's defined as one OR it's a sampler-type that isn't feeding another node.
        return def?.behavior === 'SINK' || (def?.category === 'SAMPLING' && !allOutputNodes.has(node.id));
    });

    if (sinkNodes.length === 1) return sinkNodes[0];
    
    // Prefer Save/Preview nodes if multiple sinks are found
    const saveOrPreview = sinkNodes.find(n => n.class_type.includes('Save') || n.class_type.includes('Preview'));
    if(saveOrPreview) return saveOrPreview;

    // Last resort: return any sink, or null.
    return sinkNodes[0] || null;
}


function resolvePromptFromGraph(graph: Graph): Partial<BaseMetadata> {
    const result: Partial<BaseMetadata> = { models: [], loras: [] };
    const startNode = findTerminalNode(graph);

    if (!startNode) return {};
    
    result.prompt = resolve(startNode, 'prompt', graph);
    result.negativePrompt = resolve(startNode, 'negativePrompt', graph);
    result.steps = resolve(startNode, 'steps', graph);
    result.cfg_scale = resolve(startNode, 'cfg', graph);
    result.seed = resolve(startNode, 'seed', graph);
    result.sampler = resolve(startNode, 'sampler', graph);
    result.scheduler = resolve(startNode, 'scheduler', graph);
    result.width = resolve(startNode, 'width', graph);
    result.height = resolve(startNode, 'height', graph);
    result.model = resolve(startNode, 'model', graph);
    result.loras = resolveAll(startNode, 'lora', graph);
    
    if(result.model) result.models = [result.model];

    return result;
}


export function parseComfyUIMetadata(metadata: ComfyUIMetadata): BaseMetadata {
    let result: Partial<BaseMetadata> = {};

    if (metadata.prompt || metadata.workflow) {
        try {
            const promptStr = typeof metadata.prompt === 'string' ? metadata.prompt.replace(/\bNaN\b/g, 'null') : null;
            const workflowStr = typeof metadata.workflow === 'string' ? metadata.workflow.replace(/\bNaN\b/g, 'null') : null;
            
            const promptObj = promptStr ? JSON.parse(promptStr) : metadata.prompt;
            const workflowObj = workflowStr ? JSON.parse(workflowStr) : metadata.workflow;

            if (promptObj) {
                const graph = createNodeMap(workflowObj, promptObj);
                result = resolvePromptFromGraph(graph);
            }
        } catch (e) {
            console.error("Failed to parse ComfyUI workflow/prompt with new engine:", e);
        }
    }

    // The legacy 'parameters' string is no longer used as a fallback, per the new architecture's
    // goal of relying on the graph as the single source of truth.

    const sanitizeNumber = (value: any, defaultValue = 0) => {
        const num = Number(value);
        return isNaN(num) ? defaultValue : num;
    };

    return {
        format: 'ComfyUI',
        prompt: result.prompt ?? '',
        negativePrompt: result.negativePrompt ?? '',
        model: result.model ?? (result.models && result.models.length > 0 ? result.models[0] : 'Unknown'),
        width: sanitizeNumber(result.width),
        height: sanitizeNumber(result.height),
        steps: sanitizeNumber(result.steps),
        cfg_scale: sanitizeNumber(result.cfg_scale),
        seed: sanitizeNumber(result.seed),
        scheduler: result.scheduler ?? 'Unknown',
        sampler: result.sampler ?? 'Unknown',
        loras: result.loras ?? [],
        models: result.models ?? [],
    } as BaseMetadata;
}