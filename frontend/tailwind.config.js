/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 主色 - 深青绿 #1A4D3A
        primary: {
          50:  '#e8f0ec',
          100: '#c4d9d0',
          200: '#9cbfb1',
          300: '#70a590',
          400: '#34755c',
          500: '#1A4D3A',
          600: '#154031',
          700: '#103428',
          800: '#0b271f',
          900: '#051a14',
        },
        // 辅助色 - 浅青绿 #2C6B52（进度条、次要按钮）
        secondary: {
          50:  '#eaf3ef',
          100: '#cde0d7',
          200: '#a8caba',
          300: '#7eb39c',
          400: '#5c9f84',
          500: '#2C6B52',
          600: '#245944',
          700: '#1d4736',
          800: '#153528',
          900: '#0c231a',
        },
        // 背景色 - 米杏色 #F8F5F0
        'bg-main': '#F8F5F0',
        // 边框/分割线 - 浅米色 #E8E2D9
        'border': '#E8E2D9',
        // 危险/删除 - 暗红 #D32F2F
        danger: {
          50:  '#fbeaea',
          100: '#f5cbcb',
          200: '#ee9b9b',
          300: '#e66a6a',
          400: '#df4242',
          500: '#D32F2F',
          600: '#b02828',
          700: '#8e2121',
          800: '#6b1a1a',
          900: '#481313',
        },
        // 成功状态 - 绿色 #4CAF50
        success: {
          50:  '#eaf7eb',
          100: '#c5e9c8',
          200: '#9dd9a1',
          300: '#6ec873',
          400: '#4cbb51',
          500: '#4CAF50',
          600: '#3f9142',
          700: '#327335',
          800: '#255528',
          900: '#18371a',
        },
        // 编辑操作 - 浅卡其 #E6C288
        edit: {
          50:  '#fdf8f0',
          100: '#f9edda',
          200: '#f2dfbc',
          300: '#ebd09c',
          400: '#e6c688',
          500: '#E6C288',
          600: '#d4aa62',
          700: '#c2923f',
          800: '#a0772b',
          900: '#7e5c1c',
        },
        // 辅助文字色
        'text-muted': '#999999',
        // 基础文字色
        'text-primary': '#1A1A1A',
        // 面板暖底（基于米杏色）
        warm: {
          50:  '#fdfcf9',
          100: '#fbf9f5',
          200: '#faf7f2',
          300: '#f8f5f0',
          400: '#f5f1eb',
          500: '#F0EBE1',
          600: '#d0c8b8',
          650:'#8b8983'
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
