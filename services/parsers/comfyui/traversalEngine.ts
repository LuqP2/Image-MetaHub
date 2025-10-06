import { ComfyUIPrompt, ComfyUINode } from '../../../types';
import { NodeRegistry, NodeDefinition, ComfyTraversableParam, ComfyNodeDataType, ParamMappingRule } from './nodeRegistry';

// Represents a node in the graph, simplified for parsing.
export interface GraphNode {
    id: string;
    class_type: string;
    inputs: Record<string, any>;
    widgets_values?: any[];
    widgets?: { name: string }[];
}

// A map of node IDs to nodes.
export type Graph = Record<string, GraphNode>;

// Represents a link from one node to another.
export type NodeLink = [
  sourceNodeId: string,
  sourceOutputSlot: number
];

/**
 * Encapsulates all necessary information for a single traversal operation.
 * This state is passed through the recursive traversal calls, tracking the search progress.
 */
export interface TraversalState {
  /** The high-level parameter being searched for (e.g., 'seed'). */
  readonly targetParam: ComfyTraversableParam;
  /** The expected data type of the current connection being followed. */
  readonly expectedType: ComfyNodeDataType;
  /** The path of node IDs visited to reach the current point. */
  readonly path: string[];
  /** A set of visited links ('nodeId:outputSlot') to prevent infinite loops. */
  readonly visitedLinks: Set<string>;
  /** The full graph being traversed. */
  readonly graph: Graph;
}

function getInitialExpectedType(param: ComfyTraversableParam): ComfyNodeDataType {
    switch (param) {
        case 'prompt':
        case 'negativePrompt':
            return 'CONDITIONING';
        case 'model':
            return 'MODEL';
        case 'vae':
            return 'VAE';
        case 'width':
        case 'height':
            return 'LATENT';
        case 'sampler':
            return 'SAMPLER';
        case 'scheduler':
            return 'SCHEDULER';
        case 'lora':
            return 'MODEL'; // LoRAs are applied to models, so we start by tracing the model path.
        default:
            return 'ANY';
    }
}

/**
 * Extracts a value from a node based on a parameter mapping rule.
 * @param node The node to extract the value from.
 * @param rule The rule defining where to find the value.
 * @param state The current traversal state for recursive calls.
 * @returns The extracted value, which could be a literal or a new traversal result.
 */
function extractValue(node: GraphNode, rule: ParamMappingRule, state: TraversalState, accumulator: any[]): any {
    if (rule.source === 'input') {
        const value = node.inputs[rule.key];
        if (Array.isArray(value)) {
            // It's a link, needs to be traversed
            return traverseFromLink(value as NodeLink, state, accumulator);
        }
        // It's a literal value
        return value;
    }
    if (rule.source === 'widget') {
        // Find the index of the widget by its name
        const widgetIndex = node.widgets?.findIndex((w) => w.name === rule.key);
        if (widgetIndex !== -1 && node.widgets_values && node.widgets_values.length > widgetIndex) {
            return node.widgets_values[widgetIndex];
        }
    }
    return null;
}

/**
 * The core recursive function of the traversal engine. It traverses the graph
 * from the current node backwards, following type-aware paths based on the
 * current traversal state.
 * @param currentNode The node currently being inspected.
 * @param state The current traversal state.
 * @returns The resolved value, or null if the path is a dead end.
 */
function traverse(currentNode: GraphNode, state: TraversalState, accumulator: any[]): any {
    const nodeDef = NodeRegistry[currentNode.class_type];

    // If node is unknown, we can't proceed down this path.
    if (!nodeDef) {
        return state.targetParam === 'lora' ? accumulator : null;
    }

    // --- BASE CASE & ACCUMULATION ---
    // Check if this node is a source of the parameter we're looking for.
    const paramRule = nodeDef.param_mapping?.[state.targetParam];
    if (paramRule) {
        const value = extractValue(currentNode, paramRule, state, accumulator);
        if (value !== null && !Array.isArray(value)) {
            // For 'lora', we accumulate. For others, we return the first value found.
            if (state.targetParam === 'lora') {
                if(!accumulator.includes(value)) accumulator.push(value);
            } else {
                return value;
            }
        }
    }

    // --- RECURSIVE STEP ---
    // Continue traversing, even if a value was found for accumulation cases (LoRAs).
    if (nodeDef.behavior === 'PASS_THROUGH' || nodeDef.behavior === 'TRANSFORM') {
        // For these nodes, find an input that matches the *expected* type to continue the trace correctly.
        for (const [inputName, inputDef] of Object.entries(nodeDef.inputs)) {
            if (inputDef.type === state.expectedType) {
                const inputLink = currentNode.inputs[inputName];
                if (Array.isArray(inputLink)) {
                    return traverseFromLink(inputLink as NodeLink, state, accumulator);
                }
            }
        }
    }

    // This path is a dead end. Return what we've found so far.
    return state.targetParam === 'lora' ? accumulator : null;
}

function traverseFromLink(link: NodeLink, state: TraversalState, accumulator: any[]): any {
    const [sourceNodeId, sourceOutputSlot] = link;
    const linkId = `${sourceNodeId}:${sourceOutputSlot}`;

    // Cycle detection
    if (state.visitedLinks.has(linkId)) {
        return state.targetParam === 'lora' ? accumulator : null;
    }

    const nextNode = state.graph[sourceNodeId];
    if (!nextNode) {
        return state.targetParam === 'lora' ? accumulator : null;
    }

    // Create the new state for the next recursive call.
    const newState: TraversalState = {
        ...state,
        path: [...state.path, sourceNodeId],
        visitedLinks: new Set(state.visitedLinks).add(linkId),
    };

    return traverse(nextNode, newState, accumulator);
}

/**
 * The main entry point for the new parsing engine. It resolves a single high-level
 * parameter by initiating a traversal from a designated starting node.
 * @param startNode The node to begin the backward traversal from.
 * @param targetParam The parameter to resolve (e.g., 'prompt').
 * @param graph The complete node graph.
 * @returns The resolved value, or null if not found.
 */
export function resolve(startNode: GraphNode, targetParam: ComfyTraversableParam, graph: Graph): any {
    const initialState: TraversalState = {
        targetParam,
        expectedType: getInitialExpectedType(targetParam),
        path: [startNode.id],
        visitedLinks: new Set(),
        graph,
    };
    return traverse(startNode, initialState, []);
}

/**
 * Resolves all instances of a parameter, like collecting all LoRAs applied to a model.
 * @param startNode The node to begin the backward traversal from.
 * @param targetParam The parameter to resolve (e.g., 'lora').
 * @param graph The complete node graph.
 * @returns An array of all resolved values.
 */
export function resolveAll(startNode: GraphNode, targetParam: ComfyTraversableParam, graph: Graph): any[] {
    const initialState: TraversalState = {
        targetParam,
        expectedType: getInitialExpectedType(targetParam),
        path: [startNode.id],
        visitedLinks: new Set(),
        graph,
    };
    return traverse(startNode, initialState, []);
}