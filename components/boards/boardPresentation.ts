export function getBoardDisplayName(name: string): string {
  return name.split(/[\\/]/).filter(Boolean).pop() || name;
}
