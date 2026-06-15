# Sentinel's Journal

🛡️ Security learnings and critical observations.

## 2025-05-15 - Unauthorized File System Enumeration and Information Disclosure in IPC Handlers
**Vulnerability:** Several IPC handlers (`list-directory-files`, `open-cache-location`, `show-item-in-folder`) lacked sufficient path validation. This allowed the renderer process to list contents of any directory, disclose existence of files outside allowed scopes, or open system folders arbitrarily.
**Learning:** Security-critical utility functions (like `isPathAllowed`, `isAllowedOrInternal`) must be consistently applied to all IPC handlers that interact with the file system. Selective or removed validation for "convenience" (like in exports or internal cache opening) creates path traversal risks.
**Prevention:** Enforce mandatory path validation for every file-system-related IPC handler. Use a defense-in-depth approach by combining `isPathAllowed` (for indexed content) with `isApprovedWritePath` (for exports) and `isInternalPath` (for app data).
