/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
      },
      colors: {
        'gray-100': '#f7fafc',
        'gray-200': '#edf2f7',
        'gray-300': '#e2e8f0',
        'gray-400': '#cbd5e0',
        'gray-500': '#a0aec0',
        'gray-600': '#718096',
        'gray-700': '#4a5568',
        'gray-800': '#2d3748',
        'gray-900': '#1a202c',
        'blue-500': '#3b82f6',
      }
    },
  },
  plugins: [],
}