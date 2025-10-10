/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        'gray-950': '#0a0a0a',
        'gray-900': '#1a1a1a',
        'gray-800': '#1e1e1e',
        'gray-700': '#2d2d2d',
        'gray-600': '#444444',
        'gray-400': '#a0a0a0',
        'blue-500': '#3b82f6',
        'accent': '#3b82f6',
      }
    },
  },
  plugins: [],
}
