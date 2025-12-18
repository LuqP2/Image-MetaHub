# Changelog

All notable changes to @image-metahub/metadata-engine will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-beta.1] - 2025-12-18

### Added

- Initial beta release of standalone metadata engine package
- Parse AI-generated image metadata from 15+ formats:
  - ComfyUI with full graph traversal and node registry
  - InvokeAI with boards, VAE, and workflow support
  - Automatic1111 with Civitai resources detection
  - Forge (SD WebUI variant)
  - SD.Next (Automatic1111 fork)
  - SwarmUI with sui_image_params
  - Easy Diffusion with sidecar JSON support
  - Midjourney with prompt flags (--v, --ar, --q, --s)
  - Niji Journey (--niji)
  - DALL-E 3 with C2PA/EXIF content credentials
  - Adobe Firefly with C2PA/EXIF
  - DreamStudio (Stability AI)
  - Draw Things (iOS/Mac app)
  - Fooocus with Flux support
- `parseImageFile(filePath)` - Parse single image
- `parseFiles(filePaths)` - Batch processing
- Full TypeScript support with type definitions and type guards
- Normalized `BaseMetadata` schema for all formats
- SHA-256 hashing for deduplication
- Image dimension extraction from PNG and JPEG
- Metadata source detection (PNG chunks, JPEG EXIF, sidecar JSON)
- Schema versioning (v1.0.0)
- Telemetry tracking (parser name, source, timing)
- Dual build: CommonJS (CJS) + ECMAScript Modules (ESM)
- Complete API documentation in README
- Examples for common use cases

### Technical Details

- Package size: 61.9 KB (compressed), 342.3 KB (unpacked)
- Node.js 16+ support
- Minimal dependencies: only `exifr` for JPEG EXIF parsing
- Built with TypeScript 5.2+ in strict mode
- Bundled with tsup for optimal tree-shaking

### Parser Features

- **ComfyUI**: Advanced graph traversal with 180+ node definitions
- **PNG Metadata**: Reads tEXt, iTXt, zTXt chunks with deflate decompression
- **JPEG Metadata**: Full EXIF and XMP support via exifr
- **C2PA Support**: Content credentials for DALL-E and Adobe Firefly
- **Sidecar Files**: JSON companion files (Easy Diffusion)
- **Error Handling**: Graceful fallbacks and detailed error messages

### Known Limitations

- Browser support requires polyfills for `zlib` and `fs` modules
- ComfyUI workflows with custom nodes may need manual node registry updates
- Image dimensions read from file headers only (not workflow settings)

## [1.0.0] - TBD

Planned stable release after beta testing.

[Unreleased]: https://github.com/LuqP2/image-metahub/compare/v1.0.0-beta.1...HEAD
[1.0.0-beta.1]: https://github.com/LuqP2/image-metahub/releases/tag/v1.0.0-beta.1
