<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Local Image Browser for InvokeAI

> **⚠️ Disclaimer:** This project is an independent, community-created tool and is **not affiliated with or endorsed by** Invoke AI, Inc. or the official InvokeAI project. "InvokeAI" is a trademark of Invoke AI, Inc. This tool is designed to work with InvokeAI-generated images but is developed and maintained independently.

This repository contains a small web app for browsing InvokeAI-generated images locally.

## Run Locally

**Prerequisites:** Node.js (LTS recommended)

1. Install dependencies:
   `npm install`
2. Run the dev server:
   `npm run dev`

## Features

✨ **Enhanced Local Image Browser** with the following improvements:

### 🎯 **Core Features**
- **Local Image Browsing**: Browse your AI-generated images directly from your local folder
- **Smart Search**: Search through image metadata to find specific prompts, models, and settings
- **File System Access**: Uses modern browser APIs to access local directories securely
- **InvokeAI Compatibility**: Optimized for browsing InvokeAI outputs with metadata extraction

### 🔧 **Advanced Filtering & Organization**
- **Model & LoRA Filtering**: Filter images by AI models and LoRA (41+ models, 18+ LoRAs detected)
- **Multiple Sort Options**: 
  - Alphabetical (A-Z, Z-A)
  - Date-based (Newest First, Oldest First)
- **Flexible Pagination**: Choose 10, 20, 50, 100 items per page, or view all images at once
- **Real-time Search**: Instant search results as you type through 17k+ images

### ⚡ **Performance & Caching**
- **Thumbnail Support**: Automatic detection and use of InvokeAI thumbnail cache (.webp files)
- **Smart Caching**: IndexedDB cache for instant loading (first scan ~4 min, subsequent loads ~10 sec)
- **Incremental Updates**: Only processes new/changed images on subsequent scans
- **Lazy Loading**: Images load as you scroll for optimal performance

### ♿ **Accessibility & UX**
- **ARIA Support**: Full screen reader compatibility with proper labels and live regions
- **Keyboard Navigation**: Navigate through controls using keyboard only
- **Focus Management**: Clear focus indicators and logical tab order
- **Progress Feedback**: Visual progress bars and status updates during processing

### 💾 **Persistence**
- **Settings Persistence**: Your sort preferences and items-per-page settings are saved automatically
- **Directory Memory**: The app remembers your last selected directory name for easy reference

### 🎨 **Modern Design**
- **Dark Theme**: Eye-friendly dark interface optimized for long browsing sessions
- **Responsive Layout**: Works seamlessly on desktop, tablet, and mobile devices
- **Smooth Animations**: Polished transitions and visual feedback
- **Professional UI**: Clean, modern interface with gradients and proper spacing

### 🔒 **Privacy & Security**
- **Local-Only Processing**: All image processing happens locally in your browser
- **No Data Upload**: Your images and metadata never leave your device
- **Browser Security**: Leverages modern File System Access API with proper permissions

## Browser Compatibility

This app requires a modern browser that supports the File System Access API:
- ✅ Chrome 86+
- ✅ Edge 86+
- ❌ Firefox (not yet supported)
- ❌ Safari (not yet supported)

## Technical Details

Built with:
- **React 18** with TypeScript for type safety
- **Vite** for fast development and building  
- **Tailwind CSS** for responsive styling
- **File System Access API** for local file browsing
- **IndexedDB** for intelligent caching
- **PNG Metadata Parsing** for InvokeAI metadata extraction

## Performance & Scalability

Tested and optimized for large collections:
- ✅ **17,559+ images** processed successfully
- ✅ **5,500+ images/minute** processing speed
- ✅ **~3-4 minutes** initial scan for 18k images
- ✅ **~10 seconds** subsequent loads with cache
- ✅ **Thumbnail optimization** using InvokeAI's .webp cache
- ✅ **Memory efficient** with lazy loading and pagination

## License & Attribution

This project is licensed under MIT License and is completely independent from InvokeAI. 

InvokeAI is licensed under Apache-2.0 by Invoke AI, Inc. This tool reads publicly available metadata from PNG files but does not include any InvokeAI source code.
