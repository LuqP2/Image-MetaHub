#!/usr/bin/env node

/**
 * Development startup script for Image MetaHub
 * Allows passing --dir argument to Electron while running Vite dev server
 * 
 * Usage:
 *   npm run dev:app
 *   npm run dev:app -- --dir "/path/to/images"
 */

import { spawn } from 'child_process';
import waitOn from 'wait-on';

const VITE_URL = 'http://localhost:5173';

// Parse command line arguments (everything after the script name)
const args = process.argv.slice(2);

let viteProcess = null;
let electronProcess = null;

function startVite() {
  console.log('🚀 Starting Vite dev server...');
  
  viteProcess = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    shell: true,
  });

  viteProcess.on('error', (error) => {
    console.error('❌ Failed to start Vite:', error);
    process.exit(1);
  });
  
  return viteProcess;
}

async function waitForVite() {
  console.log('⏳ Waiting for Vite server to be ready...');
  try {
    await waitOn({
      resources: [VITE_URL],
      timeout: 30000,
      interval: 100,
    });
    console.log('✅ Vite server is ready!');
  } catch (error) {
    console.error('❌ Timeout waiting for Vite server');
    throw error;
  }
}

function startElectron(args) {
  console.log('⚡ Starting Electron...');
  if (args.length > 0) {
    console.log('   📁 with arguments:', args.join(' '));
  }
  
  electronProcess = spawn('electron', ['.', ...args], {
    stdio: 'inherit',
    shell: true,
  });

  electronProcess.on('close', (code) => {
    console.log(`\n⚡ Electron exited with code ${code}`);
    cleanup();
    process.exit(code || 0);
  });

  electronProcess.on('error', (error) => {
    console.error('❌ Failed to start Electron:', error);
    cleanup();
    process.exit(1);
  });

  return electronProcess;
}

function cleanup() {
  console.log('\n🛑 Shutting down...');
  
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }
  
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill();
  }
}

async function main() {
  try {
    // Start Vite dev server
    startVite();
    
    // Wait for Vite to be ready
    await waitForVite();
    
    // Start Electron with any provided arguments
    startElectron(args);
    
    // Handle cleanup on exit
    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Error starting development environment:', error);
    cleanup();
    process.exit(1);
  }
}

main();
