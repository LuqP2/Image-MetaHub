// Shared by the renderer and Electron. No filesystem access or executable templates.
export const emptyEditor = () => ({ version: 1, title: '', notes: '', tags: [], favorite: false, category: '', metadata: { model: '', generator: '', loras: [], sampler: '', scheduler: '' }, preview: null, document: null, variables: [] });
const string = (value) => typeof value === 'string' ? value : '';
export const normalizeTags = (values) => [...new Set((Array.isArray(values) ? values : []).map((v) => string(v).trim().toLocaleLowerCase()).filter(Boolean))];
export function normalizeVariables(values) {
  if(!Array.isArray(values))
    return [];
  const names = new Set();
  return values.map((v) => {
    if(!v || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name) || names.has(v.name))
      throw new Error('Variable names must be unique and use letters, numbers and underscores.');
    names.add(v.name);
    const options = [...new Set((Array.isArray(v.options) ? v.options : []).map(string))];
    if(v.type !== 'text' && v.type !== 'select')
      throw new Error('Unknown variable type.');
    const defaultValue = string(v.defaultValue);
    return { name: v.name, label: string(v.label) || v.name, type: v.type, defaultValue, required: v.required === true, options };
  });
}
export function blockFieldNames(text) {
  return [...new Set(Array.from(text.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g), match => match[1]))];
}
export function activeBlockFields(text, definitions) {
  const known = new Map(definitions.map(variable => [variable.name, variable]));
  return blockFieldNames(text).map(name => known.get(name) || {
    name, label: '', type: 'text', defaultValue: '', required: true, options: [],
  });
}
const normalizeBlockVariables = (text, definitions) => normalizeVariables(activeBlockFields(text, normalizeVariables(definitions)));
const normalizeTextVariables = (text, definitions) => {
  const names = new Set(blockFieldNames(text));
  return normalizeVariables(definitions).filter(variable => names.has(variable.name));
};
// One content contract for creation, persistence, comparison and explicit refresh.
export function blockSnapshotContent(block) {
  const text = string(block.text);
  return { title: string(block.editor?.title), text, variables: normalizeBlockVariables(text, block.editor?.variables) };
}
export function normalizeDocument(value) {
  if(!value)
    return null;
  if(value.version !== 1 || !['plain', 'template'].includes(value.mode))
    throw new Error('Unsupported prompt document.');
  const parts = (values) => {
    if(!Array.isArray(values))
      throw new Error('Prompt parts must be a list.');
    const ids = new Set();
    return values.map((p) => {
      if(!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) || !['text', 'block'].includes(p.kind))
        throw new Error('Invalid prompt part.');
      ids.add(p.id);
      return {
        id: p.id, kind: p.kind, text: string(p.text), enabled: p.enabled !== false,
        ...(p.kind === 'block' ? { blockId: string(p.blockId), blockRevision: Number.isInteger(p.blockRevision) ? p.blockRevision : 1, title: string(p.title), variables: normalizeBlockVariables(string(p.text), p.variables) } :
          p.variables ? { variables: normalizeTextVariables(string(p.text), p.variables) } : {})
      };
    });
  };
  const separator = (v) => [', ', ' ', '\n'].includes(v) ? v : ', ';
  const positive = parts(value.positive), negative = parts(value.negative);
  const mode = [...positive, ...negative].some(part => part.kind === 'block' && part.variables.length) ? 'template' : value.mode;
  return { version: 1, mode, positive, negative, positiveSeparator: separator(value.positiveSeparator), negativeSeparator: separator(value.negativeSeparator), variables: normalizeVariables(value.variables) };
}
export function normalizeEditor(value) {
  if(value != null && (typeof value !== 'object' || (value.version !== undefined && value.version !== 1)))
    throw new Error('Unsupported prompt editor data.');
  const e = value || {};
  const m = e.metadata || {};
  return {
    ...emptyEditor(), ...(string(e.folderId) ? { folderId: e.folderId } : {}), title: string(e.title), notes: string(e.notes), tags: normalizeTags(e.tags), favorite: e.favorite === true, category: string(e.category).trim(),
    metadata: { model: string(m.model), generator: string(m.generator), loras: Array.isArray(m.loras) ? m.loras.map(string).filter(Boolean) : [], sampler: string(m.sampler), scheduler: string(m.scheduler) },
    preview: e.preview === 'hidden' ? 'hidden' : e.preview && typeof e.preview === 'object' ? e.preview : null,
    document: normalizeDocument(e.document), variables: normalizeVariables(e.variables)
  };
}
export function documentText(document) {
  const join = (parts, separator) => parts.filter((p) => p.enabled && p.text.length).map((p) => p.text).join(separator);
  return { positivePrompt: join(document.positive, document.positiveSeparator), negativePrompt: join(document.negative, document.negativeSeparator) };
}
// The historical text/select discriminator remains in saved data, but both now
// accept free text and optional suggestions.
export function sameVariableDefinition(a, b) {
  const definition = (v) => [v.name, v.label, v.defaultValue, v.required, v.options];
  return JSON.stringify(definition(a)) === JSON.stringify(definition(b));
}
export function allVariables(document) {
  const result = new Map(document.variables.map((v) => [v.name, v]));
  for(const part of [...document.positive, ...document.negative].filter((p) => p.enabled)) {
    const variables = part.kind === 'block' ? normalizeBlockVariables(part.text, part.variables) : normalizeTextVariables(part.text, part.variables);
    for(const variable of variables) {
      const existing = result.get(variable.name);
      if(existing && !sameVariableDefinition(existing, variable))
        throw new Error(`Conflicting definitions for ${variable.name}. Rename the variable before inserting this block.`);
      result.set(variable.name, variable);
    }
  }
  return [...result.values()];
}
export function compilePrompt(item, values = {}) {
  const document = item.editor?.document;
  const text = document ? documentText(document) : { positivePrompt: item.positivePrompt || '', negativePrompt: item.negativePrompt || '' };
  const errors = [];
  if(!document || document.mode !== 'template')
    return { ...text, errors };
  let variables;
  try {
    variables = allVariables(document);
  }
  catch(error) {
    return { ...text, errors: [error.message] };
  }
  const definitions = new Map(variables.map((v) => [v.name, v]));
  const expand = (source) => source.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (token, name) => {
    const v = definitions.get(name);
    if(!v) {
      errors.push(`Define variable ${name}.`);
      return token;
    }
    const value = Object.prototype.hasOwnProperty.call(values, name) ? string(values[name]) : v.defaultValue;
    if(v.required && !value.trim())
      errors.push(`Fill ${v.label}.`);
    return value;
  });
  return { positivePrompt: expand(text.positivePrompt), negativePrompt: expand(text.negativePrompt), errors: [...new Set(errors)] };
}
export function makeDocument(positivePrompt = '', negativePrompt = '') {
  const part = (text) => ({ id: crypto.randomUUID(), kind: 'text', text, enabled: true });
  return { version: 1, mode: 'plain', positive: [part(positivePrompt)], negative: [part(negativePrompt)], positiveSeparator: ', ', negativeSeparator: ', ', variables: [] };
}
export function snapshotBlock(block) { return { id: crypto.randomUUID(), kind: 'block', enabled: true, blockId: block.id, blockRevision: block.revision, ...blockSnapshotContent(block) }; }
export function prepareItem(kind, input) {
  const editor = normalizeEditor(input.editor);
  if(kind === 'block') {
    const text = string(input.text);
    if(!text.trim())
      throw new Error('A non-empty block is required.');
    editor.document = null;
    return { text, editor };
  }
  const text = editor.document ? documentText(editor.document) : { positivePrompt: string(input.positivePrompt), negativePrompt: string(input.negativePrompt) };
  if(!text.positivePrompt.trim() && !text.negativePrompt.trim())
    throw new Error('Add a positive or negative prompt.');
  if(editor.document)
    allVariables(editor.document);
  return { ...text, editor };
}
export const portableItem = (item) => {
  const copy = structuredClone(item);
  delete copy.source;
  delete copy.textBasis;
  if(copy.editor)
    copy.editor.preview = copy.editor.preview === 'hidden' ? 'hidden' : null;
  return copy;
};
export function equivalentItem(kind, item) {
  const prepared = prepareItem(kind, item);
  prepared.editor.preview = null;
  delete prepared.editor.folderId;
  const doc = prepared.editor.document;
  if(doc)
    for(const part of [...doc.positive, ...doc.negative]) {
      delete part.id;
      delete part.blockId;
      delete part.blockRevision;
    }
  return JSON.stringify(prepared);
}
/** Produce a whole new snapshot before persistence; a failure never partially applies a batch. */
export function applyMutation(snapshot, command, uuid = () => crypto.randomUUID(), now = () => Date.now()) {
  const next = structuredClone(snapshot);
  next.folders ??= [];
  let selectedId;
  const folderName = value => {
    const name = string(value).trim();
    if (!name || name.length > 100) throw new Error('Folder names must contain 1–100 characters.');
    if (next.folders.some(folder => folder.id !== command.id && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A folder with this name already exists.');
    return name;
  };
  const checkFolder = id => {
    if (id && !next.folders.some(folder => folder.id === id)) throw new Error('This folder no longer exists.');
  };
  const create = (kind, input) => {
    const fields = prepareItem(kind, input);
    checkFolder(fields.editor.folderId);
    const timestamp = now();
    const base = { id: uuid(), createdAt: timestamp, updatedAt: timestamp, revision: 1, ...fields };
    const item = kind === 'block' ? base : { ...base, sourceCreatedAt: input.sourceCreatedAt || null, source: input.source || null, textBasis: input.textBasis || 'authored' };
    next[kind === 'block' ? 'blocks' : 'prompts'].push(item);
    selectedId = item.id;
    return item;
  };
  if (command.action === 'folder-create') {
    const name = folderName(command.name); selectedId = uuid(); next.folders.push({ id: selectedId, name });
  } else if (command.action === 'folder-rename' || command.action === 'folder-remove') {
    const index = next.folders.findIndex(folder => folder.id === command.id);
    if (index < 0) throw new Error('This folder no longer exists.');
    if (command.action === 'folder-rename') next.folders[index].name = folderName(command.name);
    else {
      next.folders.splice(index, 1);
      for (const item of [...next.prompts, ...next.blocks]) if (item.editor?.folderId === command.id) {
        delete item.editor.folderId; item.revision = (item.revision || 1) + 1; item.updatedAt = now();
      }
    }
  } else if(command.action === 'import') {
    if(!Array.isArray(command.prompts) || !Array.isArray(command.blocks))
      throw new Error('Invalid import.');
    const folderMapping = new Map();
    for (const folder of command.folders || []) {
      const name = string(folder.name).trim();
      if (!folder.id || !name || name.length > 100 || folderMapping.has(folder.id)) throw new Error('Invalid imported folder.');
      let existing = next.folders.find(entry => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (!existing) { existing = { id: uuid(), name }; next.folders.push(existing); }
      folderMapping.set(folder.id, existing.id);
    }
    const remapFolder = editor => ({ ...editor, folderId: folderMapping.get(editor?.folderId) || '' });
    const mapping = new Map();
    const knownBlocks = new Map(next.blocks.map((block) => [equivalentItem('block', block), block]));
    const knownPrompts = new Set(next.prompts.map((prompt) => equivalentItem('prompt', prompt)));
    for(const block of command.blocks) {
      const key = equivalentItem('block', block);
      const imported = (!command.keepDuplicates && knownBlocks.get(key)) || create('block', { ...block, editor: { ...remapFolder(block.editor), preview: null } });
      knownBlocks.set(key, imported);
      mapping.set(block.id, imported.id);
    }
    for(const source of command.prompts) {
      const item = structuredClone(source);
      item.source = null;
      item.textBasis = 'authored';
      if(item.editor) {
        item.editor = remapFolder(item.editor);
        item.editor.preview = null;
        if(item.editor.document)
          for(const part of [...item.editor.document.positive, ...item.editor.document.negative])
            if(part.kind === 'block')
              part.blockId = mapping.get(part.blockId) || '';
      }
      const key = equivalentItem('prompt', item);
      if(command.keepDuplicates || !knownPrompts.has(key))
        create('prompt', item);
      knownPrompts.add(key);
    }
  }
  else {
    if(!['prompt', 'block'].includes(command.kind))
      throw new Error('Unknown item kind.');
    const key = command.kind === 'block' ? 'blocks' : 'prompts';
    const list = next[key];
    const id = command.item?.id || command.id;
    const index = list.findIndex((p) => p.id === id);
    if(command.action === 'create')
      create(command.kind, command.item);
    else if(command.action === 'bulk') {
      const existing = new Set(list.map((item) => item.id));
      if(!Array.isArray(command.ids) || command.ids.some((id) => !existing.has(id)))
        throw new Error('A selected item no longer exists.');
      const selected = new Set(command.ids);
      const removedTags = new Set(normalizeTags(command.removeTags));
      for(const item of list.filter((p) => selected.has(p.id))) {
        const editor = normalizeEditor(item.editor);
        editor.tags = normalizeTags([...editor.tags, ...(command.addTags || [])]).filter((tag) => !removedTags.has(tag));
        if (command.folderId !== undefined) { checkFolder(command.folderId); if (command.folderId) editor.folderId = command.folderId; else delete editor.folderId; }
        if(typeof command.favorite === 'boolean')
          editor.favorite = command.favorite;
        if(command.category !== undefined && command.kind === 'block')
          editor.category = string(command.category).trim();
        Object.assign(item, { editor, revision: (item.revision || 1) + 1, updatedAt: now() });
      }
    }
    else {
      if(index < 0)
        throw new Error('This item no longer exists.');
      const current = list[index];
      if(command.action === 'remove')
        list.splice(index, 1);
      else if(command.action === 'duplicate') {
        const editor = normalizeEditor(current.editor);
        editor.title = `${editor.title || ('text' in current ? current.text : current.positivePrompt).split('\n')[0].slice(0, 70)} Copy`;
        editor.favorite = false;
        create(command.kind, { ...current, editor });
      }
      else if(command.action === 'update') {
        if(command.expectedRevision !== (current.revision || 1))
          throw new Error('This item changed in another window. Reload or save as a copy.');
        checkFolder(command.item.editor?.folderId);
        list[index] = { ...current, ...prepareItem(command.kind, command.item), revision: (current.revision || 1) + 1, updatedAt: now() };
        selectedId = current.id;
      }
      else
        throw new Error('Unknown prompt library operation.');
    }
  }
  return { ...next, selectedId };
}
