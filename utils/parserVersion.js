// Shared by the Electron main process and renderer cache manager. Keep this
// value monotonic whenever parser output changes so a newer cache is never
// rejected by another process from the same build.
export const PARSER_VERSION = 12;
