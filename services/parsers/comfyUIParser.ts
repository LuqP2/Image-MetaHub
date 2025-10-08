import { resolveAll } from './comfyui/traversalEngine';
import { ParserNode, NodeRegistry } from './comfyui/nodeRegistry';

type Graph = Record<string, ParserNode>;

/**
 * Constrói um mapa de nós simplificado a partir dos dados do workflow e do prompt.
 */
function createNodeMap(workflow: any, prompt: any): Graph {
    const graph: Graph = {};

    console.log('[createNodeMap] Has workflow.nodes?', !!workflow?.nodes);
    console.log('[createNodeMap] Prompt keys:', Object.keys(prompt || {}).slice(0, 5));

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
        console.log('[createNodeMap] Found workflow.nodes, overlaying UI data');
        for (const wNode of workflow.nodes) {
            const id = wNode.id.toString();
            if (graph[id]) {
                console.log(`[createNodeMap] Overlaying node ${id} (${wNode.type}) with widgets_values:`, wNode.widgets_values);
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

    console.log('[ComfyUI Parser] Searching for terminal node...');
    for (const nodeId in graph) {
        const node = graph[nodeId];
        const nodeDef = NodeRegistry[node.class_type];
        console.log(`[ComfyUI Parser] Node ${nodeId} (${node.class_type}): roles=${nodeDef?.roles?.join(',') || 'undefined'}`);
        
        if (nodeDef?.roles.includes('SINK')) {
            console.log(`[ComfyUI Parser] ✓ Found SINK node: ${nodeId} (${node.class_type})`);
            // Prioritize KSampler variants and workflow sampler nodes (main generation nodes)
            if (node.class_type.includes('KSampler') || node.class_type.includes('Sampler')) {
                kSamplerNode = node;
                console.log(`[ComfyUI Parser] ✓✓ Prioritizing sampler node: ${nodeId}`);
            } else if (!terminalNode) {
                terminalNode = node;
            }
        }
    }
    
    // Return KSampler if found, otherwise return any SINK node
    const result = kSamplerNode || terminalNode;
    console.log(`[ComfyUI Parser] Selected terminal node: ${result?.id} (${result?.class_type || 'none'})`);
    return result;
}

/**
 * Ponto de entrada principal. Resolve todos os parâmetros de metadados de um grafo.
 */
export function resolvePromptFromGraph(workflow: any, prompt: any): Record<string, any> {
  const graph = createNodeMap(workflow, prompt);
  
  console.log('[ComfyUI Parser] Graph nodes:', Object.keys(graph).length, 'nodes');
  console.log('[ComfyUI Parser] Node types:', Object.entries(graph).map(([id, n]) => `${id}:${n.class_type}`).join(', '));
  
  const terminalNode = findTerminalNode(graph);

  if (!terminalNode) {
    console.error("[ComfyUI Parser] ❌ Não foi possível encontrar um nó terminal (SINK) no grafo.");
    console.error("[ComfyUI Parser] Available nodes:", Object.entries(graph).map(([id, n]) => `${id}:${n.class_type}`));
    return {};
  }
  
  console.log('[ComfyUI Parser] ✅ Terminal node found:', terminalNode.id, terminalNode.class_type);
  console.log('[ComfyUI Parser] Terminal node inputs:', Object.keys(terminalNode.inputs));
  console.log('[ComfyUI Parser] Terminal node widgets_values:', terminalNode.widgets_values);
  
  // Note: width/height are NOT extracted from workflow, they're read from actual image dimensions
  const results = resolveAll({
    startNode: terminalNode,
    graph: graph,
    params: ['prompt', 'negativePrompt', 'seed', 'steps', 'cfg', 'model', 'sampler_name', 'scheduler', 'lora', 'vae', 'denoise']
  });

  console.log('[ComfyUI Parser] Resolved results (before deduplication):', JSON.stringify(results, null, 2));

  // Post-processing: deduplicate arrays and clean up prompts
  if (results.lora && Array.isArray(results.lora)) {
    // Remove duplicates while preserving order of first appearance
    results.lora = Array.from(new Set(results.lora));
    console.log('[ComfyUI Parser] Deduplicated LoRAs:', results.lora);
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
      console.log('[ComfyUI Parser] Deduplicated prompt segments:', {
        original: segments.length,
        unique: uniqueSegments.length,
        result: results.prompt
      });
    }
    
    // Additional check: if the entire prompt is literally repeated (e.g., "abc abc")
    const words = trimmedPrompt.split(/\s+/);
    const half = Math.floor(words.length / 2);
    if (words.length >= 4 && words.length % 2 === 0) {
      const firstHalf = words.slice(0, half).join(' ');
      const secondHalf = words.slice(half).join(' ');
      if (firstHalf === secondHalf && firstHalf.length > 0) {
        results.prompt = firstHalf;
        console.log('[ComfyUI Parser] Removed duplicated prompt (exact repetition):', results.prompt);
      }
    }
  }

  console.log('[ComfyUI Parser] Final results (after deduplication):', JSON.stringify(results, null, 2));

  return results;
}

