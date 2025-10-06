import { resolveAll } from './traversalEngine';
import { ParserNode, NodeRegistry } from './nodeRegistry';

type Graph = Record<string, ParserNode>;

function createNodeMap(workflow: any, prompt: any): Graph {
    const graph: Graph = {};
    // Combine nodes from workflow api and prompt api
    const allNodes = { ...workflow.nodes, ...prompt };

    for (const nodeId in allNodes) {
        if (Object.prototype.hasOwnProperty.call(allNodes, nodeId)) {
            const nodeData = allNodes[nodeId];
            graph[nodeId] = {
                id: nodeId,
                class_type: nodeData.class_type,
                inputs: nodeData.inputs || {},
                widgets_values: nodeData.widgets_values || [],
                mode: nodeData.mode,
            };
        }
    }
    return graph;
}

function findTerminalNode(graph: Graph): ParserNode | null {
    const nodeIds = Object.keys(graph);
    let terminalNode: ParserNode | null = null;

    for (const nodeId of nodeIds) {
        const node = graph[nodeId];
        const nodeDef = NodeRegistry[node.class_type];
        if (nodeDef?.roles.includes('SINK')) {
            // This is a potential terminal node. A more robust solution
            // would check if its outputs are unused.
            terminalNode = node;
            // Prioritize samplers over simple save/preview nodes
            if (nodeDef.category === 'SAMPLING') {
                return node;
            }
        }
    }
    return terminalNode;
}


export function resolvePromptFromGraph(workflow: any, prompt: any): Record<string, any> {
  const graph = createNodeMap(workflow, prompt);
  const terminalNode = findTerminalNode(graph);

  if (!terminalNode) {
    console.error("Could not find a terminal node (SINK) in the graph.");
    return {};
  }
  
  const results = resolveAll({
    startNode: terminalNode,
    graph: graph,
    params: ['prompt', 'negativePrompt', 'seed', 'steps', 'cfg', 'width', 'height', 'model', 'sampler_name', 'scheduler', 'lora', 'vae', 'denoise']
  });

  return results;
}
