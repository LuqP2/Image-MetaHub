import { describe, expect, it } from 'vitest';
import { resolvePromptFromGraph } from '../services/parsers/comfyUIParser';
import { resolvePromptFromGraph as resolveEnginePromptFromGraph } from '../packages/metadata-engine/src/parsers/comfyUIParser';

// Synthetic graphs only: no image, workflow fixture or library cache access.
for (const [name, parse] of [
  ['app', resolvePromptFromGraph],
  ['metadata-engine', resolveEnginePromptFromGraph],
] as const) {
  describe(`${name}: dangling samplers (issue #593)`, () => {
    const makePrompt = () => ({
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'synthetic.safetensors' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'A paper boat', clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry', clip: ['1', 1] } },
      '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '94': { class_type: 'KSampler', inputs: {
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
        seed: 42, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1,
      } },
      '152': { class_type: 'KSampler', inputs: {
        seed: 123, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'sgm_uniform', denoise: 1,
      } },
    });

    const expected = {
      prompt: 'A paper boat', negativePrompt: 'blurry', model: 'synthetic.safetensors',
      seed: 42, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal',
    };

    for (const source of ['prompt', 'merged'] as const) {
      it(`ignores a later unconnected sampler in ${source} data`, () => {
        const prompt = makePrompt();
        const links: unknown[][] = [];
        const workflow = {
          nodes: Object.entries(prompt).map(([id, node]) => ({
            id: Number(id), type: node.class_type, mode: 0,
            widgets_values: Object.values(node.inputs).filter(value => !Array.isArray(value))
              .flatMap((value, index) => node.class_type === 'KSampler' && index === 0
                ? [value, 'fixed'] : [value]),
            inputs: Object.entries(node.inputs).filter(([, value]) => Array.isArray(value))
              .map(([inputName, value], inputIndex) => {
                const [origin, slot] = value as (string | number)[];
                const linkId = links.length + 1;
                links.push([linkId, Number(origin), slot, Number(id), inputIndex, '*']);
                return { name: inputName, link: linkId as number | null };
              }),
          })),
          links,
        };
        workflow.nodes.find(node => node.id === 152)!.inputs = [
          { name: 'model', link: null },
          { name: 'positive', link: null },
        ];
        expect(parse(source === 'prompt' ? {} : workflow, prompt))
          .toMatchObject(expected);
      });
    }

    it('still selects the later sampler when it is connected', () => {
      const prompt = makePrompt();
      Object.assign(prompt['152'].inputs, {
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
      });
      expect(parse({}, prompt)).toMatchObject({ ...expected, seed: 123, steps: 4, cfg: 1, scheduler: 'sgm_uniform' });
    });

    for (const mode of [2, 4]) {
      it(`keeps ignoring a connected sampler with mode ${mode}`, () => {
        const prompt = makePrompt();
        Object.assign(prompt['152'].inputs, {
          model: ['1', 0], positive: ['2', 0], negative: ['3', 0],
        });
        expect(parse({ nodes: [{ id: 152, type: 'KSampler', mode }] }, prompt))
          .toMatchObject(expected);
      });
    }

    it('does not treat an array widget or missing node reference as a connected input', () => {
      const prompt = makePrompt();
      Object.assign(prompt['152'].inputs, { dimensions: [1024, 1024], model: ['missing', 0] });
      expect(parse({}, prompt)).toMatchObject(expected);
    });
  });
}
