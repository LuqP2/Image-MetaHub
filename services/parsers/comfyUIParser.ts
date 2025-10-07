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
 */
function findTerminalNode(graph: Graph): ParserNode | null {
    let terminalNode: ParserNode | null = null;

    for (const nodeId in graph) {
        const node = graph[nodeId];
        const nodeDef = NodeRegistry[node.class_type];
        if (nodeDef?.roles.includes('SINK')) {
            terminalNode = node;
            // Dá prioridade a nós de amostragem, que são mais prováveis de serem o "fim" real
            if (nodeDef.category === 'SAMPLING') {
                return node;
            }
        }
    }
    return terminalNode;
}

/**
 * Ponto de entrada principal. Resolve todos os parâmetros de metadados de um grafo.
 */
export function resolvePromptFromGraph(workflow: any, prompt: any): Record<string, any> {
  const graph = createNodeMap(workflow, prompt);
  const terminalNode = findTerminalNode(graph);

  if (!terminalNode) {
    console.error("Não foi possível encontrar um nó terminal (SINK) no grafo.");
    return {};
  }
  
  console.log('[ComfyUI Parser] Terminal node:', terminalNode.id, terminalNode.class_type);
  
  // Note: width/height are NOT extracted from workflow, they're read from actual image dimensions
  const results = resolveAll({
    startNode: terminalNode,
    graph: graph,
    params: ['prompt', 'negativePrompt', 'seed', 'steps', 'cfg', 'model', 'sampler_name', 'scheduler', 'lora', 'vae', 'denoise']
  });

  console.log('[ComfyUI Parser] Resolved results:', JSON.stringify(results, null, 2));

  return results;
}

