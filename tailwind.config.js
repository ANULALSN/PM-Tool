/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary': '#2c3e50',      // Dark Blue
        'secondary-grey': '#f7f7f8', // Athens Grey
        'secondary-pink': '#fde2e4',   // Soft Pink
        'secondary-blue': '#dfe7fd',   // Light Blue
        'accent-red': '#e74c3c',      // Muted Red
        'accent-teal': '#1abc9c',     // Light Teal
      },
    },
  },
  plugins: [],
}
