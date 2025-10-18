import { NodeRegistry, ParamMappingRule, ParserNode, ComfyTraversableParam, ComfyNodeDataType } from './nodeRegistry';

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
  accumulator: unknown[],
): unknown {
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
    let controlValue: unknown = null;

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
function extractValue(
  node: ParserNode,
  rule: ParamMappingRule,
  state: TraversalState,
  graph: Graph,
  accumulator: unknown[],
): unknown {
    if (rule.source === 'widget') {
        const nodeDef = NodeRegistry[node.class_type];
        
        // 1️⃣ Tenta via widget_order index
        const widgetIndex = nodeDef?.widget_order?.indexOf(rule.key) ?? -1;
        if (widgetIndex !== -1 && node.widgets_values?.[widgetIndex] !== undefined) {
            return node.widgets_values[widgetIndex];
        }
        
        // 2️⃣ FALLBACK: Tenta ler diretamente de inputs (workflows sem UI)
        if (!node.widgets_values || node.widgets_values.length === 0) {
            const inputValue = node.inputs?.[rule.key];
            if (inputValue !== undefined) {
                // Se é um valor direto (não link), retorna
                if (!Array.isArray(inputValue)) {
                    return inputValue;
                }
                // Se é um link, segue ele
                if (Array.isArray(inputValue) && inputValue.length === 2) {
                    return traverseFromLink(inputValue as NodeLink, state, graph, accumulator);
                }
            }
        }
        
        // 3️⃣ FALLBACK FINAL: Procura em inputs por nome similar
        const inputValue = node.inputs?.[rule.key];
        if (inputValue !== undefined && !Array.isArray(inputValue)) {
            return inputValue;
        }
        
        return undefined;
    }
    
    if (rule.source === 'input') {
        const value = node.inputs?.[rule.key];
        
        // Se é um link, segue ele
        if (Array.isArray(value) && value.length === 2) {
            return traverseFromLink(value as NodeLink, state, graph, accumulator);
        }
        
        // Se é valor direto, retorna
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
function traverseFromLink(
  link: NodeLink,
  state: TraversalState,
  graph: Graph,
  accumulator: unknown[],
): unknown {
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

export function resolve(args: { startNode: ParserNode, param: ComfyTraversableParam, graph: Graph }): unknown {
    const initialState = createInitialState(args.param);
    
    // Para LoRAs, precisamos coletar de TODOS os nós no caminho
    if (args.param === 'lora') {
        const allLoras: string[] = [];
        const visited = new Set<string>();
        
        // Função recursiva para coletar LoRAs
        function collectLoras(currentNode: ParserNode) {
            if (visited.has(currentNode.id)) return;
            visited.add(currentNode.id);
            
            // Ignora nós silenciados
            if (currentNode.mode === 2 || currentNode.mode === 4) return;
            
            const nodeDef = NodeRegistry[currentNode.class_type];
            if (!nodeDef) return;
            
            // Extrai LoRAs deste nó
            const paramRule = nodeDef.param_mapping?.lora;
            if (paramRule) {
                const value = extractValue(currentNode, paramRule, initialState, args.graph, []);
                if (Array.isArray(value)) {
                    allLoras.push(...value.filter(l => l && l !== 'None'));
                } else if (value && value !== 'None') {
                    allLoras.push(value);
                }
            }
            
            // Continua explorando inputs
            for (const inputName in currentNode.inputs) {
                const inputLink = currentNode.inputs[inputName];
                if (Array.isArray(inputLink) && inputLink.length === 2) {
                    const [sourceNodeId] = inputLink;
                    let nextNode = args.graph[sourceNodeId];
                    
                    // Suporte para grouped nodes
                    if (!nextNode && sourceNodeId.includes(':')) {
                        const parentId = sourceNodeId.split(':')[0];
                        nextNode = args.graph[parentId];
                    }
                    
                    if (nextNode) {
                        collectLoras(nextNode);
                    }
                }
            }
        }
        
        collectLoras(args.startNode);
        
        // Remove duplicatas mantendo ordem
        const uniqueLoras = [...new Set(allLoras)];
        return uniqueLoras.length > 0 ? uniqueLoras : [];
    }
    
    // Para outros parâmetros, usa traversal simples
    return traverse(args.startNode, initialState, args.graph, []);
}

export function resolveAll(
  args: { startNode: ParserNode; params: ComfyTraversableParam[]; graph: Graph },
): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  for (const param of args.params) {
    results[param] = resolve({ ...args, param });
  }
  return results;
}

