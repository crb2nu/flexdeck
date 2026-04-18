/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic palette
        semantic: {
          blue: 'var(--color-blue)',
          red: 'var(--color-red)',
          amber: 'var(--color-amber)',
          violet: 'var(--color-violet)',
          emerald: 'var(--color-emerald)',
        },
        // Backgrounds
        bg: {
          deep: 'var(--bg-deep)',
          dark: 'var(--bg-dark)',
          panel: 'var(--bg-panel)',
        },
        // Surfaces
        surface: {
          primary: 'var(--surface-primary)',
          elevated: 'var(--surface-elevated)',
        },
        // Text
        text: {
          main: 'var(--text-main)',
          dim: 'var(--text-dim)',
          muted: 'var(--text-muted)',
        },
        // Semantic status
        status: {
          ok: 'var(--color-ok)',
          warn: 'var(--color-warn)',
          error: 'var(--color-error)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
        },
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'Roboto Mono', 'monospace'],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        s: 'var(--radius-s)',
        sm: 'var(--radius-sm)',
        m: 'var(--radius-m)',
        md: 'var(--radius-md)',
        l: 'var(--radius-l)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        pill: 'var(--radius-pill)',
        full: 'var(--radius-full)',
      },
      spacing: {
        xs: 'var(--space-xs)',
        s: 'var(--space-s)',
        m: 'var(--space-m)',
        l: 'var(--space-l)',
        xl: 'var(--space-xl)',
      },
      boxShadow: {
        glass: '0 1px 2px rgba(0, 0, 0, 0.3)',
        elevated: '0 2px 8px rgba(0, 0, 0, 0.4)',
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        'glow-blue': 'var(--glow-blue)',
        'glow-red': 'var(--glow-red)',
        'glow-amber': 'var(--glow-amber)',
        'glow-violet': 'var(--glow-violet)',
        'glow-emerald': 'var(--glow-emerald)',
      },
      transitionDuration: {
        fast: 'var(--transition-fast)',
        normal: 'var(--transition-normal)',
      },
      transitionTimingFunction: {
        'out-expo': 'var(--ease-out-expo)',
        'out-back': 'var(--ease-out-back)',
        'spring': 'var(--ease-spring)',
      },
      keyframes: {
        fadeInScale: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(0, 240, 255, 0.1)' },
          '50%': { boxShadow: '0 0 16px rgba(0, 240, 255, 0.25)' },
        },
      },
      animation: {
        'fade-in-scale': 'fadeInScale 0.15s ease-out',
        shimmer: 'shimmer 1.5s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [
    function ({ addUtilities, addVariant }) {
      addVariant('motion-safe', '@media (prefers-reduced-motion: no-preference)');
      addVariant('motion-reduce', '@media (prefers-reduced-motion: reduce)');
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
