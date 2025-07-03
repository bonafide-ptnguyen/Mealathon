/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // This is the key line for React components
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}