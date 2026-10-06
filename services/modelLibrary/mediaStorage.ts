// Data URLs are accepted only at the ingestion/migration boundary. State stores references.
export async function externalizeModelMedia<T>(value: T): Promise<T> {
  const pending = new Map<string, Promise<string>>();
  async function visit(item: unknown): Promise<unknown> {
    if (typeof item === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(item)) {
      let saved = pending.get(item);
      if (!saved) {
        saved = window.electronAPI!.modelManagerStoreMedia(item).then((result) => {
          if (!result.success || !result.reference) throw new Error(result.error || 'Unable to save model image.');
          return result.reference;
        });
        pending.set(item, saved);
      }
      return saved;
    }
    if (Array.isArray(item)) {
      const result = []; for (const entry of item) result.push(await visit(entry));
      return result.some((entry, index) => entry !== item[index]) ? result : item;
    }
    if (item && typeof item === 'object') {
      const result: Record<string, unknown> = {};
      let changed = false;
      for (const [key, entry] of Object.entries(item)) { result[key] = await visit(entry); changed ||= result[key] !== entry; }
      return changed ? result : item;
    }
    return item;
  }
  return await visit(value) as T;
}
