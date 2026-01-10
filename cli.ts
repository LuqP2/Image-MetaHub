#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { parseImageFile } from './services/metadataEngine';

const program = new Command();

program
  .name('imagemetahub-cli')
  .description('Image MetaHub CLI - Parse AI-generated image metadata')
  .version('0.11.1');

type ParseOptions = { json: boolean; pretty: boolean; raw?: boolean; quiet?: boolean };
type IndexOptions = { out: string; recursive: boolean; raw?: boolean; quiet?: boolean; concurrency?: string };

function formatOutput(
  result: Awaited<ReturnType<typeof parseImageFile>>,
  includeRaw: boolean
) {
  const base = {
    file: result.file,
    format: result.metadata?.generator || null,
    raw_source: result.rawSource || null,
    sha256: result.sha256,
    dimensions: result.dimensions || null,
    metadata: result.metadata,
    schema_version: result.schema_version,
    _telemetry: result._telemetry,
    parsed_at: new Date().toISOString(),
    errors: result.errors,
  } as any;

  if (includeRaw) {
    base.raw_metadata = result.rawMetadata;
  }

  return base;
}

function isImageFile(entry: string) {
  const ext = path.extname(entry).toLowerCase();
  return ['.png', '.jpg', '.jpeg'].includes(ext);
}

async function collectFiles(dir: string, recursive: boolean): Promise<string[]> {
  const results: string[] = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      const nested = await collectFiles(fullPath, recursive);
      results.push(...nested);
    } else if (entry.isFile() && isImageFile(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

program
  .command('parse')
  .description('Parse metadata from a single image (PNG/JPG/WebP)')
  .argument('<file>', 'Image file to parse')
  .option('--json', 'Output as JSON', true)
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('--raw', 'Include raw metadata payload when available', false)
  .option('--quiet', 'Suppress informational logs', false)
  .action(async (file: string, options: ParseOptions) => {
    try {
      const filePath = path.resolve(file);
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
      }

      const result = await parseImageFile(filePath);
      const output = formatOutput(result, Boolean(options.raw));

      if (options.json) {
        console.log(options.pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output));
      } else {
        console.log(output);
      }
    } catch (error) {
      console.error('Error parsing file:', error);
      process.exit(1);
    }
  });

program
  .command('index')
  .description('Parse metadata from a directory of images and output JSONL')
  .argument('<dir>', 'Directory to scan')
  .option('--out <file>', 'Output JSONL file', 'index.jsonl')
  .option('--recursive', 'Scan subdirectories recursively', false)
  .option('--raw', 'Include raw metadata payload when available', false)
  .option('--quiet', 'Suppress informational logs', false)
  .option('--concurrency <number>', 'Number of files to process in parallel', undefined)
  .action(async (dir: string, options: IndexOptions) => {
    try {
      const dirPath = path.resolve(dir);

      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        console.error(`Error: Directory not found: ${dirPath}`);
        process.exit(1);
      }

      const files = await collectFiles(dirPath, options.recursive);
      const outputPath = path.resolve(options.out);
      const outputStream = fs.createWriteStream(outputPath);

      let processedCount = 0;
      let errorCount = 0;
      const cpuCount = Math.max(1, os.cpus().length);
      const concurrency = Math.max(1, Math.min(64, Number(options.concurrency || cpuCount) || cpuCount));

      if (!options.quiet) {
        console.log(`Scanning directory: ${dirPath}`);
        console.log(`Output file: ${outputPath}`);
        console.log(`Recursive: ${options.recursive}`);
        console.log(`Images found: ${files.length}`);
        console.log(`Concurrency: ${concurrency}`);
        console.log('---');
      }

      const queue: Promise<void>[] = [];
      let index = 0;

      const runWorker = async (filePath: string) => {
        try {
          const result = await parseImageFile(filePath);
          const entry = formatOutput(result, Boolean(options.raw));
          outputStream.write(JSON.stringify(entry) + '\n');
          processedCount++;
          if (result.errors?.length) {
            errorCount += 1;
          }
          if (!options.quiet && processedCount % 100 === 0) {
            console.log(`Processed ${processedCount}/${files.length} images...`);
          }
        } catch (err) {
          console.error(`Error parsing ${filePath}:`, err);
          errorCount++;
        }
      };

      while (index < files.length || queue.length > 0) {
        while (index < files.length && queue.length < concurrency) {
          const filePath = files[index++];
          const p = runWorker(filePath).finally(() => {
            const idx = queue.indexOf(p);
            if (idx !== -1) queue.splice(idx, 1);
          });
          queue.push(p);
        }
        if (queue.length > 0) {
          await Promise.race(queue);
        }
      }

      outputStream.end();

      if (!options.quiet) {
        console.log('---');
        console.log('✅ Indexing complete!');
        console.log(`   Processed: ${processedCount} images`);
        console.log(`   Errors: ${errorCount}`);
        console.log(`   Output: ${outputPath}`);
      }
    } catch (error) {
      console.error('Error indexing directory:', error);
      process.exit(1);
    }
  });

program.parse();
