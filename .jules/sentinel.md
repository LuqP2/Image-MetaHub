# Sentinel's Journal

🛡️ Security learnings and critical observations.

## 2025-05-15 - Unauthorized File System Enumeration in IPC Handler
**Vulnerability:** The `list-directory-files` IPC handler lacked path validation, allowing the renderer process to list contents of any directory the OS user had access to, bypassing the application's directory indexing restrictions.
**Learning:** Security-critical utility functions (like `isPathAllowed`) must be consistently applied to all new IPC handlers that interact with the file system. In a large `electron.mjs` file, it is easy to overlook these checks when adding new functionality.
**Prevention:** Implement a middleware-like pattern for IPC handlers or use a strictly typed IPC registry that enforces path validation for all handlers accepting file or directory paths.
