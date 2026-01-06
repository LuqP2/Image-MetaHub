import { describe, it, expect } from 'vitest';
import { parseForgeMetadata } from '../services/parsers/forgeParser'; 

describe('Forge Parser - Edge Cases', () => {
  it('deve separar o prompt dos steps mesmo sem quebra de linha (Bug do ExifTool/Forge)', () => {
    // Esse é o caso crítico onde "photography).Steps:" está colado
    const rawParameters = `(muses:2.0)  marionette (black:2.0) (ukj:2.0) , (black and white photography).Steps: 50, Sampler: Euler a, Schedule type: Automatic, CFG scale: 4, Seed: 2912586831, Size: 512x512, Model hash: 9e44c3ee9e, Model: NERE26-JUGG9, Version: f2.0.1v1.10.1-previous-669-gdfdcbab6`;

    const metadata = {
      parameters: rawParameters,
    };

    const result = parseForgeMetadata(metadata);

    // 1. Verifica se o prompt parou antes dos Steps
    expect(result?.prompt).toBe('(muses:2.0)  marionette (black:2.0) (ukj:2.0) , (black and white photography).');
    
    // 2. Verifica se pegou os dados técnicos corretamente
    expect(result?.steps).toBe(50);
    expect(result?.sampler).toBe('Euler a');
    expect(result?.scheduler).toBe('Automatic'); 
    expect(result?.cfg_scale).toBe(4);
    expect(result?.model).toBe('NERE26-JUGG9');
  });

  it('deve extrair Schedule type corretamente quando presente', () => {
    // Adicionei "Model hash: 123" aqui para passar no isForgeMetadata
    const rawParameters = `Um prompt normal\nSteps: 20, Sampler: DPM++ 2M Karras, Schedule type: Karras, CFG scale: 7, Model hash: 123abc456`;
    const result = parseForgeMetadata({ parameters: rawParameters });

    expect(result?.scheduler).toBe('Karras');
  });
});