import { exec } from 'child_process';
import { test, expect } from 'vitest';

test('hello world CLI command', async () => {
	return new Promise((resolve, reject) => {
		exec('node path/to/your/cli.js', (error, stdout) => {
			if (error) {
				reject(error);
			} else {
				expect(stdout.trim()).toBe('Hello, World!');
				resolve(undefined);
			}
		});
	});
});