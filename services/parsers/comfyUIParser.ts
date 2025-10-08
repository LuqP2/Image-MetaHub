import { resolveAll } from './comfyui/traversalEngine';
import { ParserNode, NodeRegistry } from './comfyui/nodeRegistry';

type Graph = Record<string, ParserNode>;

/**
 * Constrói um mapa de nós simplificado a partir dos dados do workflow e do prompt.
 */
function createNodeMap(workflow: any, prompt: any): Graph {
    const graph: Graph = {};

    // Add/overlay from prompt (execution data: class_type, inputs)
    for (const [id, pNode] of Object.entries(prompt || {})) {
        graph[id] = {
            id,
            class_type: (pNode as any).class_type,
            inputs: (pNode as any).inputs || {},
            widgets_values: (pNode as any).widgets_values,  // Keep undefined if not present
            mode: 0,
        };
    }

    // Overlay from workflow (UI data: widgets_values, mode, type if missing)
    if (workflow?.nodes) {
        for (const wNode of workflow.nodes) {
            const id = wNode.id.toString();
            if (graph[id]) {
                graph[id].widgets_values = wNode.widgets_values || [];
                graph[id].mode = wNode.mode || 0;
                graph[id].class_type = graph[id].class_type || wNode.type;
            } else {
                graph[id] = {
                    id,
                    class_type: wNode.type,
                    inputs: {},
                    widgets_values: wNode.widgets_values || [],
                    mode: wNode.mode || 0,
                };
            }
            
            // For grouped workflow nodes: DON'T apply parent widgets to children
            // The child nodes already have correct values in their "inputs" from the prompt data
            // Applying parent widgets would break the indices since parent widgets are concatenated
            // The fallback logic in extractValue will read from inputs when widgets_values is empty
        }
    }

    // If workflow has links, populate inputs for nodes without them (fallback for incomplete prompts)
    if (workflow?.links) {
        for (const link of workflow.links) {
            const [, sourceId, sourceSlot, targetId, targetSlot, , inputName] = link; // Adjust based on link format
            const targetNode = graph[targetId.toString()];
            if (targetNode && inputName) {
                targetNode.inputs[inputName] = [sourceId.toString(), sourceSlot];
            }
        }
    }

    return graph;
}

/**
 * Encontra o nó terminal do grafo, que serve como ponto de partida para a travessia.
 * Prioriza nós de geração (KSampler) sobre pós-processamento (UltimateSDUpscale).
 */
function findTerminalNode(graph: Graph): ParserNode | null {
    let terminalNode: ParserNode | null = null;
    let kSamplerNode: ParserNode | null = null;
    
    for (const nodeId in graph) {
        const node = graph[nodeId];
        const nodeDef = NodeRegistry[node.class_type];
        
        if (nodeDef?.roles.includes('SINK')) {
            // Prioritize KSampler variants and workflow sampler nodes (main generation nodes)
            if (node.class_type.includes('KSampler') || node.class_type.includes('Sampler')) {
                kSamplerNode = node;
            } else if (!terminalNode) {
                terminalNode = node;
            }
        }
    }
    
    // Return KSampler if found, otherwise return any SINK node
    const result = kSamplerNode || terminalNode;
    return result;
}/**
 * Ponto de entrada principal. Resolve todos os parâmetros de metadados de um grafo.
 */
export function resolvePromptFromGraph(workflow: any, prompt: any): Record<string, any> {
  const graph = createNodeMap(workflow, prompt);
  
  const terminalNode = findTerminalNode(graph);

  if (!terminalNode) {
    console.error("[ComfyUI Parser] ❌ Não foi possível encontrar um nó terminal (SINK) no grafo.");
    console.error("[ComfyUI Parser] Available nodes:", Object.entries(graph).map(([id, n]) => `${id}:${n.class_type}`));
    return {};
  }
  
  // Note: width/height are NOT extracted from workflow, they're read from actual image dimensions
  const results = resolveAll({
    startNode: terminalNode,
    graph: graph,
    params: ['prompt', 'negativePrompt', 'seed', 'steps', 'cfg', 'model', 'sampler_name', 'scheduler', 'lora', 'vae', 'denoise']
  });

  // Post-processing: deduplicate arrays and clean up prompts
  if (results.lora && Array.isArray(results.lora)) {
    // Remove duplicates while preserving order of first appearance
    results.lora = Array.from(new Set(results.lora));
  }
  
  // Fix duplicated prompts - check if prompt contains repeated segments
  if (results.prompt && typeof results.prompt === 'string') {
    const trimmedPrompt = results.prompt.trim();
    
    // Split by common delimiters (comma, comma+space, double space)
    const segments = trimmedPrompt.split(/,\s*|,|  +/).filter(s => s.trim());
    
    // Remove duplicate segments while preserving order
    const uniqueSegments = Array.from(new Set(segments));
    
    // If we removed duplicates, reconstruct the prompt
    if (uniqueSegments.length < segments.length) {
      results.prompt = uniqueSegments.join(', ');
    }
    
    // Additional check: if the entire prompt is literally repeated (e.g., "abc abc")
    const words = trimmedPrompt.split(/\s+/);
    const half = Math.floor(words.length / 2);
    if (words.length >= 4 && words.length % 2 === 0) {
      const firstHalf = words.slice(0, half).join(' ');
      const secondHalf = words.slice(half).join(' ');
      if (firstHalf === secondHalf && firstHalf.length > 0) {
        results.prompt = firstHalf;
      }
    }
  }

  return results;
}

