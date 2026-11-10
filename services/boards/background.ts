export const BOARD_BACKGROUND_PRESETS = [
  { label: 'Theme default', color: null },
  { label: 'White', color: '#ffffff' },
  { label: 'Light gray', color: '#e5e5e5' },
  { label: 'Medium gray', color: '#808080' },
  { label: 'Black', color: '#000000' },
] as const;

export const boardBackground = (color?: string | null, transparent = false): string =>
  transparent ? 'transparent' : color ?? 'rgb(var(--gray-950))';

export const boardGridColor = (color?: string | null): string => {
  if (!color) return 'rgb(var(--gray-700) / .55)';
  const [r, g, b] = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  return r * .299 + g * .587 + b * .114 > 140 ? '#00000030' : '#ffffff35';
};
