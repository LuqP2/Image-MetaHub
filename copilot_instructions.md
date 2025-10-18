# Copilot Instructions

This document provides instructions for interacting with the Image MetaHub codebase.

## Project Overview

Image MetaHub is a desktop application for browsing, searching, and organizing AI-generated images locally. It is built with Electron, React, and TypeScript.

## Development

- To run the application in development mode, use `npm run dev:app`.
- To run the application in browser-only mode, use `npm run dev`.

## Code Structure

- **`src/`**: Contains the main application source code.
- **`src/components/`**: Reusable UI components.
- **`src/hooks/`**: Custom React hooks.
- **`src/services/`**: Business logic services, including metadata parsers.
- **`src/store/`**: Zustand stores for state management.
- **`src/utils/`**: Utility functions.
- **`electron.mjs`**: The Electron main process.

## Metadata Parsers

The application supports multiple metadata formats, each with its own parser in `src/services/parsers/`. When adding a new parser, please follow the existing structure and add a corresponding test file.
