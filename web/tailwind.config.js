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
        // Surfaces (elevation tiers)
        surface: {
          primary: 'var(--surface-primary)',
          elevated: 'var(--surface-elevated)',
          raised: 'var(--surface-raised)',
          glass: 'var(--surface-glass)',
          modal: 'var(--surface-modal)',
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
        // Data-viz categorical palette (8 series) — channel format so
        // `/opacity` modifiers render (bg-viz-1/20, etc.).
        viz: {
          1: 'rgb(var(--viz-1) / <alpha-value>)',
          2: 'rgb(var(--viz-2) / <alpha-value>)',
          3: 'rgb(var(--viz-3) / <alpha-value>)',
          4: 'rgb(var(--viz-4) / <alpha-value>)',
          5: 'rgb(var(--viz-5) / <alpha-value>)',
          6: 'rgb(var(--viz-6) / <alpha-value>)',
          7: 'rgb(var(--viz-7) / <alpha-value>)',
          8: 'rgb(var(--viz-8) / <alpha-value>)',
        },
        // Diverging utilization scale
        util: {
          safe: 'rgb(var(--util-safe) / <alpha-value>)',
          near: 'rgb(var(--util-near) / <alpha-value>)',
          hot: 'rgb(var(--util-hot) / <alpha-value>)',
        },
        // Functional status (semantic)
        sem: {
          ok: 'rgb(var(--sem-ok) / <alpha-value>)',
          warn: 'rgb(var(--sem-warn) / <alpha-value>)',
          crit: 'rgb(var(--sem-crit) / <alpha-value>)',
        },
        // Chart gridlines
        grid: {
          line: 'var(--grid-line)',
          'line-hover': 'var(--grid-line-hover)',
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
        // Glow discipline: live + critical + a11y focus
        'glow-active': 'var(--glow-active)',
        'glow-critical': 'var(--glow-critical)',
        focus: 'var(--focus-ring)',
        // Semantic elevation ladder
        'elevation-card': 'var(--elevation-card)',
        'elevation-dropdown': 'var(--elevation-dropdown)',
        'elevation-modal': 'var(--elevation-modal)',
      },
      fontSize: {
        display: 'var(--text-display)',
        hero: 'var(--text-hero)',
      },
      zIndex: {
        base: 'var(--z-base)',
        sticky: 'var(--z-sticky)',
        dropdown: 'var(--z-dropdown)',
        modal: 'var(--z-modal)',
        tooltip: 'var(--z-tooltip)',
        overlay: 'var(--z-overlay)',
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
          '0%, 100%': { boxShadow: '0 0 8px rgba(0, 200, 255, 0.1)' },
          '50%': { boxShadow: '0 0 16px rgba(0, 200, 255, 0.25)' },
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
