/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          base: '#0c0f17',
          raised: '#141825',
          overlay: '#1a2030',
          hover: '#1e2540',
        },
        text: {
          primary: '#e8eaf2',
          secondary: '#8d96a8',
          muted: '#505970',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#818cf8',
          dim: 'rgba(99,102,241,0.12)',
        },
        border: {
          subtle: 'rgba(255,255,255,0.07)',
          DEFAULT: 'rgba(255,255,255,0.10)',
        },
        // keep vscode-* aliases so legacy code compiles during migration
        vscode: {
          bg: '#0c0f17',
          panel: '#141825',
          sidebar: '#141825',
          input: '#1a2030',
          border: 'rgba(255,255,255,0.10)',
          hover: '#1e2540',
          active: '#1a2030',
          text: '#e8eaf2',
          muted: '#8d96a8',
          accent: '#6366f1',
          'accent-hover': '#818cf8',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
