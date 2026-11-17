import { parse, TYPE } from '@formatjs/icu-messageformat-parser';

export function argumentSignature(message) {
  const argumentsUsed = new Set();
  function visit(elements) {
    for (const element of elements) {
      if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
      const selectors = element.type === TYPE.select
        ? Object.keys(element.options).sort()
        : element.type === TYPE.plural
          ? [element.pluralType, element.offset, ...Object.keys(element.options).filter((key) => key.startsWith('=')).sort()]
          : [];
      argumentsUsed.add(JSON.stringify([element.value, element.type, ...selectors]));
      if ('options' in element) {
        for (const option of Object.values(element.options)) visit(option.value);
      }
    }
  }
  visit(parse(message, { ignoreTag: true }));
  return JSON.stringify([...argumentsUsed].sort());
}
