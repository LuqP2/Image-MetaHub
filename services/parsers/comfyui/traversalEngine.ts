import { NodeRegistry, ParamMappingRule, ParserNode, ComfyTraversableParam, ComfyNodeDataType } from './nodeRegistry';

type NodeLink = [string, number];
type Graph = Record<string, ParserNode>;

interface TraversalState {
  targetParam: ComfyTraversableParam | 'generic';
  expectedType: ComfyNodeDataType;
  visitedLinks: Set<string>;
}

function createInitialState(param: ComfyTraversableParam): TraversalState {
    let expectedType: ComfyNodeDataType = 'ANY';
    switch (param) {
        case 'prompt':
        case 'negativePrompt':
            expectedType = 'CONDITIONING';
            break;
        case 'model':
            expectedType = 'MODEL';
            break;
        case 'vae':
            expectedType = 'VAE';
            break;
        case 'seed':
        case 'steps':
        case 'width':
        case 'height':
            expectedType = 'INT';
            break;
        case 'cfg':
        case 'denoise':
            expectedType = 'FLOAT';
            break;
        case 'sampler_name':
            expectedType = 'SAMPLER';
            break;
        case 'scheduler':
            expectedType = 'SCHEDULER';
            break;
        case 'lora':
            expectedType = 'MODEL'; // Lora is found by traversing model/clip paths
            break;
    }
    return {
        targetParam: param,
        expectedType,
        visitedLinks: new Set(),
    };
}


function extractValue(node: ParserNode, rule: ParamMappingRule, state: TraversalState, graph: Graph, accumulator: any[]): any {
    if (rule.source === 'widget') {
        const widgetIndex = node.widgets_values?.findIndex((w: any) => w.name === rule.key);
        return widgetIndex !== -1 ? node.widgets_values?.[widgetIndex] : undefined;
    }

    if (rule.source === 'custom_extractor') {
        return rule.extractor(node);
    }

    if (rule.source === 'trace') {
        const inputLink = node.inputs[rule.input];
        if (inputLink && Array.isArray(inputLink)) {
            return traverseFromLink(inputLink as NodeLink, state, graph, accumulator);
        }
    }
    return null;
}

function traverseFromLink(link: NodeLink, state: TraversalState, graph: Graph, accumulator: any[]): any {
    const linkId = `${link[0]}:${link[1]}`;
    if (state.visitedLinks.has(linkId)) {
        return null; // Cycle detected
    }
    state.visitedLinks.add(linkId);

    const nextNode = graph[link[0]];
    if (nextNode) {
        return traverse(nextNode, state, graph, accumulator);
    }
    return null;
}

function traverse(
  currentNode: ParserNode,
  state: TraversalState,
  graph: Graph,
  accumulator: any[] = []
): any {

  // 1. State Awareness: Skip muted/bypassed nodes
  if (currentNode.mode === 2 || currentNode.mode === 4) {
    return state.targetParam === 'lora' ? accumulator : null;
  }

  const nodeDef = NodeRegistry[currentNode.class_type];
  if (!nodeDef) {
    return state.targetParam === 'lora' ? accumulator : null;
  }

  // 2. Base Case: Direct parameter extraction
   if (state.targetParam !== 'generic' && nodeDef.param_mapping?.[state.targetParam]) {
    const rule = nodeDef.param_mapping[state.targetParam] as ParamMappingRule;
    const value = extractValue(currentNode, rule, state, graph, accumulator);

    if (state.targetParam === 'lora') {
        if(value) accumulator.push(...(Array.isArray(value) ? value : [value]));
        // For LoRA, we continue traversing the model/clip path
    } else if (value !== null) {
        return value;
    }
  }

  // 3. Dynamic Routing
  if (nodeDef.roles?.includes('ROUTING') && nodeDef.conditional_routing) {
    const controlRule: ParamMappingRule = { source: 'widget', key: nodeDef.conditional_routing.control_input };
    const controlValue = extractValue(currentNode, controlRule, { ...state, targetParam: 'generic' }, graph, []);
    
    if (controlValue != null) {
      const dynamicInputName = `${nodeDef.conditional_routing.dynamic_input_prefix}${controlValue}`;
      const inputLink = currentNode.inputs[dynamicInputName];
      if (inputLink && Array.isArray(inputLink)) {
        return traverseFromLink(inputLink as NodeLink, state, graph, accumulator);
      }
    }
    return state.targetParam === 'lora' ? accumulator : null;
  }

  // 4. Role-based traversal (PASS_THROUGH, TRANSFORM)
  if (nodeDef.roles?.includes('PASS_THROUGH') || nodeDef.roles?.includes('TRANSFORM')) {
      // Use explicit pass_through_rules first
      if(nodeDef.pass_through_rules) {
          for(const rule of nodeDef.pass_through_rules) {
               const inputLink = currentNode.inputs[rule.from_input];
               if (inputLink && Array.isArray(inputLink)) {
                  // This is a simplification; a full implementation would match output->input
                  return traverseFromLink(inputLink as NodeLink, state, graph, accumulator);
               }
          }
      }
      // Fallback to type matching
      for (const [inputName, inputDef] of Object.entries(nodeDef.inputs)) {
           if(inputDef.type === state.expectedType || inputDef.type === 'ANY') {
                const inputLink = currentNode.inputs[inputName];
                if (inputLink && Array.isArray(inputLink)) {
                    return traverseFromLink(inputLink as NodeLink, state, graph, accumulator);
                }
           }
      }
  }

  return state.targetParam === 'lora' ? accumulator : null;
}

export function resolve(args: { startNode: ParserNode, param: ComfyTraversableParam, graph: Graph }): any {
    const initialState = createInitialState(args.param);
    return traverse(args.startNode, initialState, args.graph, []);
}

export function resolveAll(args: { startNode: ParserNode, params: ComfyTraversableParam[], graph: Graph }): Record<string, any> {
    const results: Record<string, any> = {};
    for (const param of args.params) {
        results[param] = resolve({ ...args, param });
    }
    return results;
}
