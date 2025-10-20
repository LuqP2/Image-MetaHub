#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { resolvePromptFromGraph } from './services/parsers/comfyUIParser';
import { parseInvokeAIMetadata } from './services/parsers/invokeAIParser';
import { parseA1111Metadata } from './services/parsers/automatic1111Parser';

const program = new Command();

/**
 * Simple metadata parser for CLI (browser-independent)
 */
async function parseMetadata(chunks: string[]): Promise<{ format: string; metadata: any } | null> {
  for (const chunk of chunks) {
    try {
      // Try ComfyUI format
      const sanitized = chunk.replace(/:\s*NaN/g, ': null');
      const parsed = JSON.parse(sanitized);
      
      if (parsed.workflow || parsed.prompt) {
        const metadata = resolvePromptFromGraph(parsed.workflow, parsed.prompt);
        return { format: 'comfyui', metadata };
      }
      
      // Try InvokeAI format
      if (parsed.app_version || parsed.sd?.model) {
        const metadata = parseInvokeAIMetadata(parsed);
        return { format: 'invokeai', metadata };
      }
      
      // Try A1111 format (parameters field)
      if (typeof parsed === 'string' && parsed.includes('Steps:')) {
        const metadata = parseA1111Metadata(parsed);
        return { format: 'automatic1111', metadata };
      }
      
    } catch (e) {
      // Try next chunk
      continue;
    }
  }
  
  return null;
}

program
  .name('imagemetahub-cli')
  .description('Image MetaHub CLI - Parse AI-generated image metadata')
  .version('0.9.4');

/**
 * Parse a single PNG file and output JSON metadata
 */
program
  .command('parse')
  .description('Parse metadata from AI-generated images')
  .argument('<file>', 'PNG file to parse')
  .option('--json', 'Output as JSON', true)
  .option('--pretty', 'Pretty-print JSON output', false)
  .action(async (file: string, options: { json: boolean; pretty: boolean }) => {
    try {
      const filePath = path.resolve(file);
      
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
      }
      
      const ext = path.extname(filePath).toLowerCase();
      
      if (ext !== '.png') {
        console.error('Error: Only PNG files are supported for CLI parsing');
        process.exit(1);
      }
      
      // Read PNG chunks
      const buffer = fs.readFileSync(filePath);
      const png = PNG.sync.read(buffer);
      
      // Extract text chunks
      const chunks: string[] = [];
      if ((png as any).text) {
        for (const key in (png as any).text) {
          chunks.push((png as any).text[key]);
        }
      }
      
      // Parse metadata
      const result = await parseMetadata(chunks);
      
      // Output
      if (options.json) {
        const output = {
          file: filePath,
          format: result?.format || 'unknown',
          metadata: result?.metadata || null,
          parsed_at: new Date().toISOString()
        };
        
        if (options.pretty) {
          console.log(JSON.stringify(output, null, 2));
        } else {
          console.log(JSON.stringify(output));
        }
      } else {
        console.log('File:', filePath);
        console.log('Format:', result?.format || 'unknown');
        console.log('Metadata:', result?.metadata);
      }
      
    } catch (error) {
      console.error('Error parsing file:', error);
      process.exit(1);
    }
  });

/**
 * Parse a directory of images and output JSONL index
 */
program
  .command('index')
  .description('Parse metadata from a directory of images')
  .argument('<dir>', 'Directory to scan')
  .option('--out <file>', 'Output JSONL file', 'index.jsonl')
  .option('--recursive', 'Scan subdirectories recursively', false)
  .action(async (dir: string, options: { out: string; recursive: boolean }) => {
    try {
      const dirPath = path.resolve(dir);
      
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        console.error(`Error: Directory not found: ${dirPath}`);
        process.exit(1);
      }
      
      const outputPath = path.resolve(options.out);
      const outputStream = fs.createWriteStream(outputPath);
      
      let processedCount = 0;
      let errorCount = 0;
      
      console.log(`Scanning directory: ${dirPath}`);
      console.log(`Output file: ${outputPath}`);
      console.log(`Recursive: ${options.recursive}`);
      console.log('---');
      
      const scanDirectory = async (currentDir: string) => {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isDirectory() && options.recursive) {
            await scanDirectory(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            
            if (ext === '.png') {
              try {
                // Read PNG chunks
                const buffer = fs.readFileSync(fullPath);
                const png = PNG.sync.read(buffer);
                
                // Extract text chunks
                const chunks: string[] = [];
                if ((png as any).text) {
                  for (const key in (png as any).text) {
                    chunks.push((png as any).text[key]);
                  }
                }
                
                // Parse metadata
                const result = await parseMetadata(chunks);
                
                // Write JSONL entry
                const entry = {
                  file: fullPath,
                  format: result?.format || 'unknown',
                  metadata: result?.metadata || null,
                  parsed_at: new Date().toISOString()
                };
                
                outputStream.write(JSON.stringify(entry) + '\n');
                processedCount++;
                
                if (processedCount % 100 === 0) {
                  console.log(`Processed ${processedCount} images...`);
                }
                
              } catch (error) {
                console.error(`Error parsing ${fullPath}:`, error);
                errorCount++;
              }
            }
          }
        }
      };
      
      await scanDirectory(dirPath);
      
      outputStream.end();
      
      console.log('---');
      console.log(`✅ Indexing complete!`);
      console.log(`   Processed: ${processedCount} images`);
      console.log(`   Errors: ${errorCount}`);
      console.log(`   Output: ${outputPath}`);
      
    } catch (error) {
      console.error('Error indexing directory:', error);
      process.exit(1);
    }
  });

program.parse();
