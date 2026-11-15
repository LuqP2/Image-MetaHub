// Shared by the Electron main process and renderer cache manager. Keep this
// value monotonic whenever parser output changes so a newer cache is never
// rejected by another process from the same build.
// Reprocess ComfyUI metadata with Pixaroma prompts and linked sampler seeds.
export const PARSER_VERSION = 15;
