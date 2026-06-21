## 2025-05-15 - [Path Traversal in list-directory-files]
 **Vulnerability:** The `list-directory-files` IPC handler lacked path validation, allowing the renderer process to list files in any directory the OS process has access to.
 **Learning:** In complex Electron applications with many IPC handlers, filesystem-exposing methods can easily be overlooked during security audits if they don't explicitly read or write file content, even though listing files is a form of unauthorized information disclosure.
 **Prevention:** Use a 'deny-by-default' approach for all IPC handlers that accept paths. Maintain a centralized `isPathAllowed` helper and ensure it is called as the first step in every filesystem-related IPC handler.
