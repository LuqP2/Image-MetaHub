import { exec } from 'child_process';
import { promisify } from 'util';
import { test, expect, describe } from 'vitest';

const execAsync = promisify(exec);

test('CLI should show help without arguments', async () => {
	return new Promise((resolve) => {
		exec('npx tsx cli.ts', (error, stdout, stderr) => {
			// The help command often exits with a non-zero code, which is fine.
			// We just want to ensure the help text is printed to stdout or stderr.
			const output = stdout + stderr;
			expect(output).toContain('Usage: imagemetahub-cli [options] [command]');
			resolve(undefined);
		});
	});
});

/**
 * These run the CLI as a real subprocess (`tsx cli.ts parse ...`), not as an
 * in-process import, on purpose. The parse path depends on the runtime module
 * resolution tsx/Node applies to `packages/metadata-engine/src` — a bundler
 * (Vite/vitest) resolves that differently and masks failures that only the
 * shipped CLI hits. Importing parseImageFile here would not have caught the
 * regression these tests exist for.
 *
 * Fixtures are real PNGs (valid IHDR/IDAT/IEND, correct CRCs) carrying the
 * tEXt chunks their respective generators actually write.
 */
describe('CLI parse', () => {
	const run = async (fixture: string) => {
		const { stdout } = await execAsync(
			`npx tsx cli.ts parse __tests__/fixtures/cli/${fixture} --quiet`,
			{ maxBuffer: 10 * 1024 * 1024 },
		);
		return JSON.parse(stdout.trim().split('\n').pop() as string);
	};

	test('parses a real A1111 PNG', async () => {
		const result = await run('a1111.png');

		expect(result.format).toBe('Automatic1111');
		expect(result.raw_source).toBe('png');
		expect(result.dimensions).toEqual({ width: 512, height: 768 });

		expect(result.metadata).not.toBeNull();
		expect(result.metadata.prompt).toContain('astronaut riding a horse');
		expect(result.metadata.negativePrompt).toBe('blurry, low quality, watermark');
		expect(result.metadata.steps).toBe(28);
		expect(result.metadata.sampler).toBe('DPM++ 2M');
		expect(result.metadata.cfg_scale).toBe(7);
		expect(result.metadata.seed).toBe(2895438046);
		expect(result.metadata.model).toBe('v1-5-pruned-emaonly');
	}, 60000);

	test('parses a real ComfyUI PNG', async () => {
		const result = await run('comfyui.png');

		expect(result.format).toBe('ComfyUI');
		expect(result.raw_source).toBe('png');
		expect(result.dimensions).toEqual({ width: 1024, height: 1024 });

		expect(result.metadata).not.toBeNull();
		expect(result.metadata.prompt).toBe('a majestic lion in the savanna');
		expect(result.metadata.negativePrompt).toBe('text, watermark');
		expect(result.metadata.model).toBe('sd_xl_base_1.0.safetensors');
		expect(result.metadata.steps).toBe(20);
		expect(result.metadata.sampler).toBe('euler');
		expect(result.metadata.seed).toBe(156680208700286);
	}, 60000);

	// Regression guard for the actual defect: every metadata-carrying PNG/JPEG
	// threw `sharedCoreTypes.isInvokeAIMetadata is not a function` before the fix,
	// because types.ts resolves its type guards from the metadata-engine package
	// at runtime. Only AVIF escaped, via an unrelated short-circuit in
	// metadataParserFactory. Assert no file blows up in the type-guard chain.
	test.each(['a1111.png', 'comfyui.png'])(
		'%s does not fail in the shared type-guard chain',
		async (fixture) => {
			const { stdout, stderr } = await execAsync(
				`npx tsx cli.ts parse __tests__/fixtures/cli/${fixture} --quiet`,
				{ maxBuffer: 10 * 1024 * 1024 },
			);
			expect(stdout + stderr).not.toContain('is not a function');
			expect(stdout + stderr).not.toContain('Error parsing file');
		},
		60000,
	);
});
