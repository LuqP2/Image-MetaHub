## 2025-05-14 - Hardening Filesystem IPC Handlers
**Vulnerability:** Multiple IPC handlers (`list-directory-files`, `open-cache-location`, `show-item-in-folder`, `export-images-batch`, `export-images-zip`) lacked path validation, allowing a compromised renderer process to access or write to arbitrary filesystem locations.
**Learning:** Security checks were previously removed or omitted for "convenience" (e.g., to allow exports anywhere), but this broke the "Trust Nothing, Verify Everything" principle.
**Prevention:** Always enforce path validation in IPC handlers that interact with the filesystem. Use `isPathAllowed` for read-only indexed paths, `isInternalPath` for app data, and `isApprovedWritePath` for paths explicitly chosen by the user via native dialogs.
