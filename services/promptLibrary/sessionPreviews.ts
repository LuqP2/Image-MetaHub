const files = new Map<string, File>();
export function linkSessionPreview(id: string, file: File) { files.set(id, file); }
export function sessionPreviewFile(id: string) { return files.get(id); }
export function removeSessionPreview(id: string) { files.delete(id); }
export function duplicateSessionPreview(from: string, to: string) { const file = files.get(from); if (file) files.set(to, file); }
