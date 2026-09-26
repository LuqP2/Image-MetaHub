export const themeOptions = [
  { id: 'system', name: 'System', dark: null, colors: ['#525252', '#a3a3a3', '#f3f4f6'] },
  { id: 'light', name: 'Light', dark: false, colors: ['#ffffff', '#2563eb', '#111827'] },
  { id: 'dark', name: 'Dark', dark: true, colors: ['#0a0a0a', '#3b82f6', '#f3f4f6'] },
  { id: 'dracula', name: 'Dracula', dark: true, colors: ['#282a36', '#bd93f9', '#f8f8f2'] },
  { id: 'nord', name: 'Nord', dark: true, colors: ['#2e3440', '#88c0d0', '#d8dee9'] },
  { id: 'ocean', name: 'Ocean', dark: true, colors: ['#0f172a', '#38bdf8', '#e2e8f0'] },
  { id: 'ayu', name: 'Ayu', dark: true, colors: ['#0b0e14', '#e6b450', '#e6e1cf'] },
  { id: 'catppuccin', name: 'Catppuccin', dark: true, colors: ['#1e1e2e', '#cba6f7', '#cdd6f4'] },
  { id: 'github', name: 'GitHub', dark: true, colors: ['#0d1117', '#58a6ff', '#e6edf3'] },
  { id: 'matrix', name: 'Matrix', dark: true, colors: ['#080d0a', '#4ade80', '#d9fbe3'] },
  { id: 'monokai', name: 'Monokai', dark: true, colors: ['#272822', '#a6e22e', '#f8f8f2'] },
  { id: 'oscurange', name: 'Oscurange', dark: true, colors: ['#211a17', '#f39c69', '#f5e7df'] },
  { id: 'raycast', name: 'Raycast', dark: true, colors: ['#191922', '#ff677d', '#f3eef6'] },
  { id: 'solarized', name: 'Solarized', dark: true, colors: ['#002b36', '#4cb5a6', '#eee8d5'] },
  { id: 'temple', name: 'Temple', dark: true, colors: ['#171a12', '#c5d94d', '#edf0d8'] },
  { id: 'tokyo-night', name: 'Tokyo Night', dark: true, colors: ['#1a1b26', '#7aa2f7', '#c0caf5'] },
] as const;

export type ThemeId = (typeof themeOptions)[number]['id'];

export const resolveTheme = (theme: ThemeId, systemShouldUseDark: boolean) => {
  const resolvedId = theme === 'system' ? (systemShouldUseDark ? 'dark' : 'light') : theme;
  return { id: resolvedId, dark: themeOptions.find((option) => option.id === resolvedId)?.dark ?? false };
};
