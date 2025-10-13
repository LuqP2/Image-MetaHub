import { exec } from 'child_process';

test('hello world CLI command', (done) => {
	exec('node path/to/your/cli.js', (error, stdout, stderr) => {
		expect(stdout.trim()).toBe('Hello, World!');
		done();
	});
});