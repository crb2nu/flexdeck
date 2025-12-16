/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neon accents
        neon: {
          cyan: 'var(--neon-cyan)',
          pink: 'var(--neon-pink)',
          yellow: 'var(--neon-yellow)',
          purple: 'var(--neon-purple)',
          green: 'var(--neon-green)',
        },
        // Backgrounds
        bg: {
          deep: 'var(--bg-deep)',
          dark: 'var(--bg-dark)',
          panel: 'var(--bg-panel)',
        },
        // Text
        text: {
          main: 'var(--text-main)',
          dim: 'var(--text-dim)',
          muted: 'var(--text-muted)',
        },
        // Semantic
        status: {
          ok: 'var(--color-ok)',
          warn: 'var(--color-warn)',
          error: 'var(--color-error)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          primary: 'var(--accent-primary)',
          secondary: 'var(--accent-secondary)',
          tertiary: 'var(--accent-tertiary)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Roboto Mono', 'monospace'],
      },
      borderRadius: {
        s: 'var(--radius-s)',
        m: 'var(--radius-m)',
        l: 'var(--radius-l)',
        pill: 'var(--radius-pill)',
      },
      spacing: {
        xs: 'var(--space-xs)',
        s: 'var(--space-s)',
        m: 'var(--space-m)',
        l: 'var(--space-l)',
        xl: 'var(--space-xl)',
      },
      backdropBlur: {
        glass: '12px',
      },
      boxShadow: {
        glass: '0 4px 12px rgba(0, 0, 0, 0.4)',
      },
      keyframes: {
        fadeInScale: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in-scale': 'fadeInScale 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
