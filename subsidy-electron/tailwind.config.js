/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 主色 - 深青绿 #1A4D3A
        primary: {
          50:  '#F2F7F4',
          100: '#E2EDE6',
          200: '#C4DACC',
          300: '#9BC0A8',
          400: '#6C9C7D',
          500: '#43765A',
          600: '#2F5C46',
          700: '#234A38',
          800: '#1A3A2C',
          900: '#122B20',
        },
        secondary: {
          50:  '#F2F7F4',
          100: '#E2EDE6',
          200: '#C4DACC',
          300: '#9BC0A8',
          400: '#6C9C7D',
          500: '#43765A',
          600: '#2F5C46',
          700: '#234A38',
          800: '#1A3A2C',
          900: '#122B20',
        },
        'bg-main': '#F3EFE7',
        'border': '#E6E0D4',
        danger: {
          50:  '#FCEAE8',
          100: '#F5D3CF',
          200: '#EFB3AD',
          300: '#E08B84',
          400: '#C9483D',
          500: '#B91C1C',
          600: '#A81D1D',
          700: '#8F1717',
          800: '#741212',
          900: '#560D0D',
        },        // 辅助文字色
        'text-muted': '#7A7466',
        // 基础文字色
        'text-primary': '#2C2A23',
        // 面板暖底（基于米杏色）
        warm: {
          50:  '#FAF8F4',
          100: '#F3EFE7',
          200: '#E6E0D4',
          300: '#D2CBBC',
          400: '#A8A091',
          500: '#7A7466',
          600: '#5C5749',
          650: '#434035',
        },
        // 暖色标签
        'orange-tag': '#EAA45E',
      },
      fontFamily: {
        sans: ['PingFang SC', 'Microsoft YaHei', 'Roboto', 'sans-serif'],
        body: ['PingFang SC', 'Microsoft YaHei', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        'h2': ['20px', { lineHeight: '1.4', fontWeight: '700' }],
        'nav': ['15px', { lineHeight: '1.4' }],
        'card-title': ['15px', { lineHeight: '1.5', fontWeight: '700' }],
        'body': ['14px', { lineHeight: '1.6' }],
        'meta': ['12px', { lineHeight: '1.5' }],
        'data-lg': ['20px', { lineHeight: '1.3', fontWeight: '700' }],
      },
      borderRadius: {
        'btn': '4px',
        'card': '8px',
      },
      boxShadow: {
        'card': '0 1px 4px rgba(0,0,0,0.04)',
        'card-hover': '0 2px 8px rgba(0,0,0,0.06)',
      },
      height: {
        header: '70px',
      },
      spacing: {
        'card': '16px',
        'list': '12px',
      },
      borderWidth: {
        'selected': '4px',
      },
    },
  },
  plugins: [],
}
