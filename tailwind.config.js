/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0a0c',
        panel: '#111116',
        line: '#252533',
        indigoGlow: '#818cf8',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(129, 140, 248, 0.12), 0 18px 50px rgba(0, 0, 0, 0.26)',
      },
    },
  },
  plugins: [],
}
