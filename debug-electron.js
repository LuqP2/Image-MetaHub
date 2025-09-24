#!/usr/bin/env node

/**
 * Debug script for Electron environment detection issues
 * Run this to help diagnose macOS Electron app problems
 */

console.log('🔍 Electron Environment Debug Script');
console.log('=====================================');

// Check if we're in Node.js environment
console.log('📊 Environment Info:');
console.log('  - process.platform:', typeof process !== 'undefined' ? process.platform : 'N/A');
console.log('  - process.type:', typeof process !== 'undefined' ? process.type : 'N/A');
console.log('  - process.versions.electron:', typeof process !== 'undefined' ? process.versions?.electron : 'N/A');
console.log('  - globalThis.process:', typeof globalThis !== 'undefined' && globalThis.process ? 'available' : 'not available');

// Check if we're in browser environment
console.log('🌐 Browser Environment:');
console.log('  - window defined:', typeof window !== 'undefined');
console.log('  - navigator.userAgent:', typeof navigator !== 'undefined' ? navigator.userAgent.substring(0, 50) + '...' : 'N/A');

// Check Electron API availability
console.log('⚡ Electron API Check:');
if (typeof window !== 'undefined') {
  console.log('  - window.electronAPI:', typeof window.electronAPI);
  if (window.electronAPI) {
    console.log('  - Available methods:', Object.keys(window.electronAPI));
    console.log('  - listDirectoryFiles method:', typeof window.electronAPI.listDirectoryFiles);
    console.log('  - showDirectoryDialog method:', typeof window.electronAPI.showDirectoryDialog);
  }
}

// Check localStorage
console.log('💾 localStorage Check:');
if (typeof localStorage !== 'undefined') {
  const electronPath = localStorage.getItem('invokeai-electron-directory-path');
  console.log('  - invokeai-electron-directory-path:', electronPath ? `"${electronPath}"` : 'null');
  console.log('  - localStorage available:', 'yes');
} else {
  console.log('  - localStorage available:', 'no');
}

// Test path joining
console.log('📁 Path Joining Test:');
const testPaths = [
  { base: '/Users/test', file: 'image.png' },
  { base: 'C:\\Users\\test', file: 'image.png' },
  { base: '/Users/test/', file: 'image.png' },
  { base: 'C:\\Users\\test\\', file: 'image.png' }
];

testPaths.forEach(({ base, file }) => {
  const forwardSlash = base + '/' + file;
  const backSlash = base + '\\' + file;
  console.log(`  - "${base}" + "/" + "${file}" = "${forwardSlash}"`);
  console.log(`  - "${base}" + "\\" + "${file}" = "${backSlash}"`);
});

console.log('\n✅ Debug script completed. Check the output above for issues.');