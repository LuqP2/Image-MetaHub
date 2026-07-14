import { describe, it, expect } from 'vitest';
import { extractResourceRefs, normalizeResourceName } from './resourceExtraction';

describe('extractResourceRefs', () => {
  it('extracts checkpoint + LoRA hashes from an A1111 parameters string', () => {
    const params =
      'a prompt, <lora:- SDXL - AI-Breaker_V3.5:.5>\n' +
      'Negative prompt: 3d\n' +
      'Steps: 15, Seed: 980493476, Size: 816x1232, ' +
      'Model hash: 36fab8f31a, Model: SDXL - T - haveallsdxl_v10, ' +
      'Lora hashes: "- SDXL - AI-Breaker_V3.5: 62064ee0c3ba, CBS_novuschroma38 style: 29179d2a6166", ' +
      'Hashes: {"lora:- SDXL - AI-Breaker_V3.5": "458cc11561", "lora:CBS_novuschroma38 style": "a1c6e6cad2", "model": "36fab8f31a"}';

    const refs = extractResourceRefs({ parameters: params });
    const checkpoints = refs.filter((r) => r.type === 'checkpoint');
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].hash).toBe('36fab8f31a');

    const loras = refs.filter((r) => r.type === 'lora');
    expect(loras).toHaveLength(2);
    expect(loras.every((l) => !!l.hash)).toBe(true);
  });

  it('extracts model version ids from a `Civitai resources:` block', () => {
    const params =
      'a prompt\nSteps: 30, Seed: 1, Size: 832x1216, ' +
      'Civitai resources: [' +
      '{"type":"checkpoint","modelVersionId":691639,"modelName":"FLUX","modelVersionName":"Dev"},' +
      '{"type":"lora","weight":0.3,"modelVersionId":1527024,"modelName":"FLUX.1-dev-LoRA-Cinematic"}' +
      '], Civitai metadata: {}';

    const refs = extractResourceRefs({ parameters: params });
    expect(refs).toEqual([
      { type: 'checkpoint', name: 'FLUX', modelVersionId: 691639 },
      { type: 'lora', name: 'FLUX.1-dev-LoRA-Cinematic', modelVersionId: 1527024 },
    ]);
  });

  it('extracts InvokeAI blake3 model + lora hashes, stripping the prefix', () => {
    const raw = {
      model: {
        key: 'd1aac6dc',
        hash: 'blake3:473a76d0adb6d3a1f63398f1dbe6b902cc6e09ee635c0655d1976a4bf6b6ad39',
        name: 'Architecture (RealVisXL5)',
      },
      loras: [{ model: { hash: 'blake3:1234abcd5678ef90', name: 'MyLora' }, weight: 0.7 }],
    };

    const refs = extractResourceRefs(raw);
    expect(refs).toEqual([
      { type: 'checkpoint', name: 'Architecture (RealVisXL5)', hash: '473a76d0adb6d3a1f63398f1dbe6b902cc6e09ee635c0655d1976a4bf6b6ad39' },
      { type: 'lora', name: 'MyLora', hash: '1234abcd5678ef90' },
    ]);
  });

  it('extracts the checkpoint hash from a MetaHub Save Node chunk', () => {
    // MetaHub-saved images keep only `imagemetahub_data`; the `parameters`
    // chunk (with the LoRA hash) is dropped by the indexer.
    const raw = {
      imagemetahub_data: {
        generator: 'ComfyUI',
        model: 'intorealism_zitV70.safetensors',
        model_hash: '62ef7640ab',
        loras: [{ name: 'Z-Detail-Slider.safetensors', weight: 0.5325 }],
      },
    };
    expect(extractResourceRefs(raw)).toEqual([
      { type: 'checkpoint', name: 'intorealism_zitV70.safetensors', hash: '62ef7640ab' },
    ]);
  });

  it('extracts MetaHub LoRA hashes when present on the lora entry', () => {
    const raw = {
      imagemetahub_data: {
        model: 'ckpt',
        model_hash: 'aaaa1111bbbb',
        loras: [{ name: 'MyLora', hash: 'cccc2222dddd' }],
      },
    };
    const refs = extractResourceRefs(raw);
    expect(refs).toContainEqual({ type: 'lora', name: 'MyLora', hash: 'cccc2222dddd' });
  });

  it('falls back to `Model hash:` when there is no richer source', () => {
    const params = 'a prompt\nSteps: 20, Model hash: ABCDEF1234, Model: myCheckpoint';
    expect(extractResourceRefs({ parameters: params })).toEqual([
      { type: 'checkpoint', name: 'myCheckpoint', hash: 'abcdef1234' },
    ]);
  });

  it('returns [] when nothing is linkable', () => {
    expect(extractResourceRefs({ parameters: 'just a prompt, Steps: 20' })).toEqual([]);
    expect(extractResourceRefs({ workflow: '{}' })).toEqual([]);
    expect(extractResourceRefs(null)).toEqual([]);
  });
});

describe('normalizeResourceName', () => {
  it('lowercases and strips path + extension', () => {
    expect(normalizeResourceName('subdir\\My-LoRA.safetensors')).toBe('my-lora');
    expect(normalizeResourceName('folder/Other.ckpt')).toBe('other');
  });
});
