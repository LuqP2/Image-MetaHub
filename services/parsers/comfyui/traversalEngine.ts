import { NodeRegistry, ParamMappingRule, ParserNode, ComfyTraversableParam, ComfyNodeDataType, NodeDefinition } from './nodeRegistry';

type NodeLink = [string, number];
type Graph = Record<string, ParserNode>;

interface TraversalState {
  targetParam: ComfyTraversableParam | 'generic';
  expectedType: ComfyNodeDataType;
  visitedLinks: Set<string>;
}

// Helper para criar o estado inicial da travessia
function createInitialState(param: ComfyTraversableParam): TraversalState {
    let expectedType: ComfyNodeDataType = 'ANY';
    // Mapeia o parâmetro para um tipo de dado inicial para guiar a busca
    switch (param) {
        case 'prompt': case 'negativePrompt': expectedType = 'CONDITIONING'; break;
        case 'model': case 'lora': expectedType = 'MODEL'; break;
        case 'vae': expectedType = 'VAE'; break;
        case 'seed': case 'steps': case 'width': case 'height': expectedType = 'INT'; break;
        case 'cfg': case 'denoise': expectedType = 'FLOAT'; break;
        case 'sampler_name': expectedType = 'SAMPLER'; break;
        case 'scheduler': expectedType = 'SCHEDULER'; break;
    }
    return { targetParam: param, expectedType, visitedLinks: new Set() };
}

/**
 * Função central, recursiva, que navega o grafo para trás.
 * @param currentNode O nó sendo inspecionado atualmente.
 * @param state O estado da travessia (o que está sendo procurado).
 * @param graph O grafo completo do workflow.
 * @param accumulator Usado para coletar múltiplos valores (ex: LoRAs).
 * @returns O valor resolvido ou o acumulador.
 */
function traverse(
  currentNode: ParserNode,
  state: TraversalState,
  graph: Graph,
  accumulator: any[]
): any {
  // 1. Consciência de Estado: Ignora nós silenciados ("muted")
  if (currentNode.mode === 2 || currentNode.mode === 4) {
    return state.targetParam === 'lora' ? accumulator : null;
  }

  const nodeDef = NodeRegistry[currentNode.class_type];
  if (!nodeDef) {
    return state.targetParam === 'lora' ? accumulator : null; // Nó desconhecido
  }

  // 2. Extração de Parâmetro (Caso Base ou Rastreamento)
  const paramRule = state.targetParam !== 'generic' ? nodeDef.param_mapping?.[state.targetParam] : undefined;
  if (paramRule) {
    const value = extractValue(currentNode, paramRule, state, graph, accumulator);
    if (state.targetParam === 'lora') {
      if (value) accumulator.push(...(Array.isArray(value) ? value : [value]));
      // Para LoRA, a travessia continua pelo caminho do modelo
    } else if (value !== null) {
      return value; // Valor encontrado, termina a busca para este parâmetro
    }
  }

  // 3. Roteamento Dinâmico (Problema do "Switch")
  if (nodeDef.roles.includes('ROUTING') && nodeDef.conditional_routing) {
    const controlInputName = nodeDef.conditional_routing.control_input;
    let controlValue: any = null;
    
    // Tenta resolver o valor de controle, que pode ser um widget ou um link
    const controlLink = currentNode.inputs[controlInputName];
    if (controlLink && Array.isArray(controlLink)) {
      const controlState = { ...createInitialState('steps'), visitedLinks: state.visitedLinks }; // 'steps' -> INT
      controlValue = traverseFromLink(controlLink as NodeLink, controlState, graph, []);
    } else {
        const widgetValue = currentNode.widgets_values?.find(w => typeof w === 'object' ? w.name === controlInputName : false) ?? currentNode.widgets_values?.[0];
        controlValue = typeof widgetValue === 'object' ? widgetValue.value : widgetValue;
    }

    if (controlValue != null) {
      const dynamicInputName = `${nodeDef.conditional_routing.dynamic_input_prefix}${controlValue}`;
      const targetLink = currentNode.inputs[dynamicInputName];
      if (targetLink && Array.isArray(targetLink)) {
        return traverseFromLink(targetLink as NodeLink, state, graph, accumulator);
      }
    }
    return state.targetParam === 'lora' ? accumulator : null; // Rota dinâmica não encontrada
  }

  // 4. Travessia Estática (PASS_THROUGH / TRANSFORM)
  if (nodeDef.roles.includes('PASS_THROUGH') || nodeDef.roles.includes('TRANSFORM')) {
    // Procura por entradas que correspondam ao tipo de dado esperado para continuar a cadeia
    for (const inputName in nodeDef.inputs) {
      const inputDef = nodeDef.inputs[inputName];
      if (inputDef.type === state.expectedType || inputDef.type === 'ANY') {
        const inputLink = currentNode.inputs[inputName];
        if (inputLink && Array.isArray(inputLink)) {
           const result = traverseFromLink(inputLink as NodeLink, state, graph, accumulator);
           // Retorna o primeiro resultado encontrado, a menos que esteja acumulando LoRAs
           if (state.targetParam !== 'lora' && result !== null) {
               return result;
           }
        }
      }
    }
  }

  // 5. Fim do Caminho
  return state.targetParam === 'lora' ? accumulator : null;
}

/**
 * Extrai um valor de um nó com base numa regra, podendo iniciar uma sub-travessia.
 */
function extractValue(node: ParserNode, rule: ParamMappingRule, state: TraversalState, graph: Graph, accumulator: any[]): any {
    if (rule.source === 'widget') {
        const nodeDef = NodeRegistry[node.class_type];
        
        // Try widget_order index first
        const widgetIndex = nodeDef?.widget_order?.indexOf(rule.key) ?? -1;
        if (widgetIndex !== -1 && node.widgets_values?.[widgetIndex] !== undefined) {
            return node.widgets_values[widgetIndex];
        }
        
        // FALLBACK: If no widgets_values, try reading directly from inputs (for workflows without UI data)
        if (!node.widgets_values || node.widgets_values.length === 0) {
            const inputValue = node.inputs?.[rule.key];
            if (inputValue !== undefined) {
                // If it's a direct value (not a link), return it
                if (!Array.isArray(inputValue)) {
                    return inputValue;
                }
                // If it's a link, follow it
                if (Array.isArray(inputValue) && inputValue.length === 2) {
                    return traverseFromLink(inputValue as NodeLink, state, graph, accumulator);
                }
            }
        }
        
        return undefined;
    }
    if (rule.source === 'input') {
        const value = node.inputs?.[rule.key];
        // For input source, return the value even if it's a link (extractValue caller handles links separately)
        return value;
    }
    if (rule.source === 'custom_extractor') {
        return rule.extractor(node, state, graph, traverseFromLink);
    }
    if (rule.source === 'trace') {
        const inputLink = node.inputs[rule.input];
        if (inputLink && Array.isArray(inputLink)) {
            return traverseFromLink(inputLink as NodeLink, state, graph, accumulator);
        }
    }
    return null;
}

/**
 * Continua a travessia a partir de um link de entrada, evitando ciclos.
 */
function traverseFromLink(link: NodeLink, state: TraversalState, graph: Graph, accumulator: any[]): any {
    const [sourceNodeId, sourceOutputSlot] = link;
    const linkId = `${sourceNodeId}:${sourceOutputSlot}`;

    if (state.visitedLinks.has(linkId)) return null; // Ciclo detectado

    const nextNode = graph[sourceNodeId];
    if (!nextNode) return null;

    const newState: TraversalState = {
        ...state,
        visitedLinks: new Set(state.visitedLinks).add(linkId),
    };

    return traverse(nextNode, newState, graph, accumulator);
}

// --- Funções de Ponto de Entrada ---

/**
 * Coleta todos os valores encontrados para um parâmetro, explorando todos os caminhos possíveis.
 */
function collectAllValues(startNode: ParserNode, state: TraversalState, graph: Graph): any[] {
    const values: any[] = [];
    collectValuesRecursive(startNode, state, graph, values, new Set());
    return values;
}

function collectValuesRecursive(
    currentNode: ParserNode, 
    state: TraversalState, 
    graph: Graph, 
    values: any[], 
    visited: Set<string>
): void {
    // Evita ciclos
    if (visited.has(currentNode.id)) return;
    visited.add(currentNode.id);

    // 1. Consciência de Estado: Ignora nós silenciados
    if (currentNode.mode === 2 || currentNode.mode === 4) {
        return;
    }

    const nodeDef = NodeRegistry[currentNode.class_type];
    if (!nodeDef) return;

    // 2. Extração de Parâmetro
    const paramRule = state.targetParam !== 'generic' ? nodeDef.param_mapping?.[state.targetParam] : undefined;
    if (paramRule) {
        const value = extractValue(currentNode, paramRule, state, graph, []);
        if (value !== null && value !== undefined) {
            values.push(value);
        }
    }

    // 3. Continua a exploração para todos os caminhos possíveis
    for (const inputName in currentNode.inputs) {
        const inputLink = currentNode.inputs[inputName];
        if (inputLink && Array.isArray(inputLink)) {
            const [sourceNodeId] = inputLink;
            const nextNode = graph[sourceNodeId];
            if (nextNode) {
                collectValuesRecursive(nextNode, state, graph, values, visited);
            }
        }
    }
}

/**
 * Seleciona o melhor valor de prompt entre múltiplas opções.
 */
function selectBestPromptValue(values: any[], paramType: ComfyTraversableParam): any {
    if (values.length === 0) return null;
    if (values.length === 1) return values[0];

    // Filtra valores válidos (não vazios, não nulos)
    const validValues = values.filter(v => 
        v !== null && 
        v !== undefined && 
        v !== '' && 
        (!Array.isArray(v) || v.length > 0)
    );

    if (validValues.length === 0) return null;
    if (validValues.length === 1) return validValues[0];

    // Para prompts, prefere o mais longo e informativo
    return validValues.reduce((best, current) => {
        const bestStr = String(best || '').trim();
        const currentStr = String(current || '').trim();
        
        // Prefere prompts não vazios
        if (!bestStr && currentStr) return current;
        if (!currentStr) return best;
        
        // Prefere o mais longo
        if (currentStr.length > bestStr.length) return current;
        
        return best;
    });
}

export function resolve(args: { startNode: ParserNode, param: ComfyTraversableParam, graph: Graph }): any {
    const initialState = createInitialState(args.param);
    
    // Use simple traverse for all parameters - it follows the correct path based on param_mapping
    return traverse(args.startNode, initialState, args.graph, []);
}

export function resolveAll(args: { startNode: ParserNode, params: ComfyTraversableParam[], graph: Graph }): Record<string, any> {
    const results: Record<string, any> = {};
    for (const param of args.params) {
        results[param] = resolve({ ...args, param });
    }
    return results;
}

