/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        primary: '#1A4D3A',
        'primary-light': '#2C6B52',
        'primary-dark': '#0F3526',
        secondary: '#2C6B52',
        background: '#F8F5F0',
        border: '#E8E2D9',
        danger: '#D32F2F',
        success: '#4CAF50',
        edit: '#E6C288',
      },
      fontFamily: {
        sans: ['PingFang SC', 'Microsoft YaHei', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
