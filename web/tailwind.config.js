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
      boxShadow: {
        glass: '0 4px 12px rgba(0, 0, 0, 0.4)',
      },
      keyframes: {
        fadeInScale: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.3' },
          '50%': { opacity: '0.8' },
        },
        scanLine: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
        pingSlow: {
          '0%': { transform: 'scale(1)', opacity: '0.5' },
          '75%, 100%': { transform: 'scale(1.8)', opacity: '0' },
        },
        pingFast: {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '75%, 100%': { transform: 'scale(1.5)', opacity: '0' },
        },
        spinSlow: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-in-scale': 'fadeInScale 0.2s ease-out',
        'breathe': 'breathe 4s ease-in-out infinite',
        'scan-line': 'scanLine 3s linear infinite',
        'ping-slow': 'pingSlow 3s cubic-bezier(0, 0, 0.2, 1) infinite',
        'ping-fast': 'pingFast 1s cubic-bezier(0, 0, 0.2, 1) infinite',
        'ping-normal': 'pingSlow 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'spin-slow': 'spinSlow 12s linear infinite',
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        '.motion-reduce\\:animate-none': {
          '@media (prefers-reduced-motion: reduce)': {
            animation: 'none',
          },
        },
      });
    },
  ],
};
