#!/usr/bin/env node

/**
 * Complete Cache Reset Script for Image MetaHub
 * This script completely removes ALL application data and caches
 * Use this to test the app in a completely fresh state
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧹 COMPLETE Image MetaHub Cache Reset Script');
console.log('===============================================');
console.log('⚠️  WARNING: This will delete ALL application data!');
console.log('   - IndexedDB caches');
console.log('   - localStorage data');
console.log('   - Electron userData directory');
console.log('   - Browser cache/storage');
console.log('');

// Ask for confirmation
if (process.argv.includes('--yes') || process.argv.includes('-y')) {
  console.log('🚀 Proceeding with cache reset...');
} else {
  console.log('Run with --yes or -y to confirm: npm run reset-cache -- --yes');
  process.exit(0);
}

// Function to get Electron userData directory
function getElectronUserDataDir() {
  const appName = 'ImageMetaHub';
  let userDataDir;

  switch (process.platform) {
    case 'win32':
      userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', appName);
      break;
    case 'darwin':
      userDataDir = path.join(os.homedir(), 'Library', 'Application Support', appName);
      break;
    case 'linux':
      userDataDir = path.join(os.homedir(), '.config', appName);
      break;
    default:
      console.log('❌ Unsupported platform');
      return null;
  }

  return userDataDir;
}

// Clear Electron userData directory
function clearElectronCache() {
  const userDataDir = getElectronUserDataDir();
  if (!userDataDir) return;

  console.log(`📁 Checking Electron userData directory: ${userDataDir}`);

  if (fs.existsSync(userDataDir)) {
    try {
      // Remove the entire directory
      fs.rmSync(userDataDir, { recursive: true, force: true });
      console.log('✅ Electron userData directory cleared');
    } catch (error) {
      console.error('❌ Error clearing Electron userData:', error.message);
    }
  } else {
    console.log('ℹ️ Electron userData directory not found (first run?)');
  }
}

// Clear dist-electron directory (built app cache)
function clearDistElectron() {
  const distDir = path.join(__dirname, 'dist-electron');
  console.log(`📁 Checking dist-electron directory: ${distDir}`);

  if (fs.existsSync(distDir)) {
    try {
      fs.rmSync(distDir, { recursive: true, force: true });
      console.log('✅ dist-electron directory cleared');
    } catch (error) {
      console.error('❌ Error clearing dist-electron:', error.message);
    }
  } else {
    console.log('ℹ️ dist-electron directory not found');
  }
}

// Clear node_modules/.vite cache
function clearViteCache() {
  const viteCacheDir = path.join(__dirname, 'node_modules', '.vite');
  console.log(`📁 Checking Vite cache: ${viteCacheDir}`);

  if (fs.existsSync(viteCacheDir)) {
    try {
      fs.rmSync(viteCacheDir, { recursive: true, force: true });
      console.log('✅ Vite cache cleared');
    } catch (error) {
      console.error('❌ Error clearing Vite cache:', error.message);
    }
  } else {
    console.log('ℹ️ Vite cache not found');
  }
}

// Clear TypeScript build cache
function clearTSBuildCache() {
  const tsBuildCache = path.join(__dirname, 'tsconfig.tsbuildinfo');
  console.log(`📁 Checking TypeScript build cache: ${tsBuildCache}`);

  if (fs.existsSync(tsBuildCache)) {
    try {
      fs.unlinkSync(tsBuildCache);
      console.log('✅ TypeScript build cache cleared');
    } catch (error) {
      console.error('❌ Error clearing TypeScript build cache:', error.message);
    }
  } else {
    console.log('ℹ️ TypeScript build cache not found');
  }
}

// Clear browser data (Chrome/Chromium cache)
function clearBrowserData() {
  console.log('🌐 Browser cache clearing instructions:');
  console.log('   For Chrome/Chromium:');
  console.log('   1. Open chrome://settings/clearBrowserData');
  console.log('   2. Select "Cached images and files" and "Cookies and other site data"');
  console.log('   3. Clear data for "Last hour"');
  console.log('');
  console.log('   Or run this app in an incognito/private window');
}

// Try to kill any running Electron processes
function killElectronProcesses() {
  console.log('🔪 Killing any running Electron processes...');

  try {
    switch (process.platform) {
      case 'win32':
        try {
          execSync('taskkill /f /im electron.exe', { stdio: 'ignore' });
          execSync('taskkill /f /im ImageMetaHub.exe', { stdio: 'ignore' });
        } catch {
          // Ignore errors if processes aren't running
        }
        break;
      case 'darwin':
        try {
          execSync('pkill -f electron', { stdio: 'ignore' });
          execSync('pkill -f "Image MetaHub"', { stdio: 'ignore' });
        } catch {
          // Ignore errors if processes aren't running
        }
        break;
      case 'linux':
        try {
          execSync('pkill -f electron', { stdio: 'ignore' });
          execSync('pkill -f imagemetahub', { stdio: 'ignore' });
        } catch {
          // Ignore errors if processes aren't running
        }
        break;
    }
    console.log('✅ Electron processes killed');
  } catch {
    console.log('ℹ️ No running Electron processes found');
  }
}

console.log('\n🔧 Starting complete cache reset...');

// Kill running processes first
killElectronProcesses();

// Clear all caches
clearElectronCache();
clearDistElectron();
clearViteCache();
clearTSBuildCache();
clearBrowserData();

console.log('\n🎉 Complete cache reset finished!');
console.log('🔄 The application is now in a completely fresh state.');
console.log('');
console.log('Next steps:');
console.log('1. Close all browser tabs/windows with the app');
console.log('2. Clear browser cache manually (see instructions above)');
console.log('3. Restart the application');
console.log('');
console.log('💡 Tip: Use incognito/private browsing mode for testing');