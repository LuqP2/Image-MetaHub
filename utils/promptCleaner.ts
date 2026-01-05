/**
 * Limpa artefatos comuns de prompts processados por wildcards
 * NOTE: Does NOT remove LoRA tags - we preserve the original prompt
 */
export function cleanPrompt(text: string | null | undefined): string {
  if (!text) return '';

  return text
    // Remove wildcards não resolvidos
    .replace(/__[a-zA-Z0-9/_-]+__/g, '')

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

/**
 * Extracts LoRAs with weights from <lora:name:weight> syntax
 * Returns an array of LoRAInfo objects or strings (if weight is invalid)
 */
export function extractLoRAsWithWeights(text: string): (string | { name: string; weight: number })[] {
  const loras: (string | { name: string; weight: number })[] = [];
  const loraNames = new Set<string>();

  const loraPattern = /<lora:([^:>]+):([^>]+)>/gi;
  let match;

  while ((match = loraPattern.exec(text)) !== null) {
    const name = match[1].trim();
    const weightStr = match[2].trim();

    if (name && !loraNames.has(name)) {
      loraNames.add(name);

      // Try to parse weight as number
      const weight = parseFloat(weightStr);

      // Return object with weight if valid, otherwise just the name
      if (!isNaN(weight)) {
        loras.push({ name, weight });
      } else {
        loras.push(name);
      }
    }
  }

  return loras;
}