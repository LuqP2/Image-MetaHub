## 2026-06-20 - Path Traversal in IPC Handlers
**Vulnerability:** The `list-directory-files` IPC handler was missing path validation, allowing the renderer process to list any directory on the host system. Additionally, `show-item-in-folder` and `open-cache-location` had insufficient or missing checks.
**Learning:** IPC handlers that accept filesystem paths from the renderer are high-risk entry points. In an Electron app, these must always be validated against a whitelist of allowed directories to maintain the security sandbox.
**Prevention:** Always use `isPathAllowed`, `isInternalPath`, or `isApprovedWritePath` (or the combined `isAllowedOrInternal`) to validate every path received via IPC before performing filesystem operations or opening paths in the OS shell.
