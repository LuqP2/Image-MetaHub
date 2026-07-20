/** @type {import('tailwindcss').Config} */
import plugin from 'tailwindcss/plugin';

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        'gray-950': 'rgb(var(--gray-950) / <alpha-value>)',
        'gray-900': 'rgb(var(--gray-900) / <alpha-value>)',
        'gray-800': 'rgb(var(--gray-800) / <alpha-value>)',
        'gray-700': 'rgb(var(--gray-700) / <alpha-value>)',
        'gray-600': 'rgb(var(--gray-600) / <alpha-value>)',
        'gray-500': 'rgb(var(--gray-500) / <alpha-value>)',
        'gray-400': 'rgb(var(--gray-400) / <alpha-value>)',
        'gray-300': 'rgb(var(--gray-300) / <alpha-value>)',
        'gray-200': 'rgb(var(--gray-200) / <alpha-value>)',
        'gray-100': 'rgb(var(--gray-100) / <alpha-value>)',
        'gray-50': 'rgb(var(--gray-50) / <alpha-value>)',
        'blue-500': 'rgb(var(--blue-500) / <alpha-value>)',
        'accent': 'rgb(var(--accent) / <alpha-value>)',
      }
    },
  },
  plugins: [
    // Override utilities only under the light theme, without regressing the
    // dark themes (dark/dracula/nord/ocean). Use for accent-colored text
    // (red/blue/yellow literals) that don't flip via the gray/accent CSS vars.
    plugin(({ addVariant }) => {
      addVariant('light', '[data-theme="light"] &');
    }),
  ],
}
