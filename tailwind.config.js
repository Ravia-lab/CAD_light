/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: '#070B14',
          900: '#0B1120',
          850: '#0F1626',
          800: '#131B2E',
          700: '#1B2439',
          600: '#26314A',
          500: '#39455F',
        },
        accent: {
          DEFAULT: '#38BDF8',
          soft: '#7DD3FC',
          deep: '#0EA5E9',
          teal: '#2DD4BF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Cascadia Mono', 'Consolas', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(56,189,248,0.35), 0 8px 32px -8px rgba(56,189,248,0.45)',
        panel: '0 24px 64px -24px rgba(0,0,0,0.9)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
