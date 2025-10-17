/**
 * Limpa artefatos comuns de prompts processados por wildcards
 */
export function cleanPrompt(text: string | null | undefined): string {
  if (!text) return '';
  
  return text
    // Remove wildcards não resolvidos
    .replace(/__[a-zA-Z0-9/_-]+__/g, '')
    
    // Remove tags de LoRA (já extraídas separadamente)
    .replace(/<lora:[^>]+>/gi, '')
    
    // Limpa pontuação duplicada
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    
    // Normaliza espaços
    .replace(/,\s+/g, ', ')
    .replace(/\.\s+/g, '. ')
    .replace(/\s+/g, ' ')
    
    // Remove espaços no início/fim
    .trim()
    
    // Remove vírgulas/pontos no início
    .replace(/^[,.\s]+/, '')
    
    // Remove vírgulas/pontos no fim
    .replace(/[,.\s]+$/, '');
}

/**
 * Limpa nome de LoRA
 */
export function cleanLoraName(lora: string): string {
  return lora
    .replace(/^(?:flux|Flux|FLUX)[\\/]+/i, '')
    .replace(/\.safetensors$/i, '')
    .trim();
}