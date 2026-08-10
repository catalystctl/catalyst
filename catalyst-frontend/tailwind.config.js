import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // External plugin UIs (vite @plugins → ../catalyst-plugins)
    '../catalyst-plugins/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans Variable"', 'DM Sans', 'system-ui', 'sans-serif'],
        display: ['"Outfit Variable"', 'Outfit', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          // Theme-store rewrites these at runtime for customization
          50: 'hsl(var(--primary-50))',
          100: 'hsl(var(--primary-100))',
          200: 'hsl(var(--primary-200))',
          300: 'hsl(var(--primary-300))',
          400: 'hsl(var(--primary-400))',
          500: 'hsl(var(--primary-500, var(--primary)))',
          600: 'hsl(var(--primary-600))',
          700: 'hsl(var(--primary-700))',
          800: 'hsl(var(--primary-800))',
          900: 'hsl(var(--primary-900))',
          950: 'hsl(var(--primary-950))',
        },
        'primary-foreground': 'hsl(var(--primary-foreground))',
        secondary: 'hsl(var(--secondary))',
        'secondary-foreground': 'hsl(var(--secondary-foreground))',
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        'accent-foreground': 'hsl(var(--accent-foreground))',
        destructive: 'hsl(var(--destructive))',
        'destructive-foreground': 'hsl(var(--destructive-foreground))',
        ring: 'hsl(var(--ring))',
        success: {
          DEFAULT: 'hsl(var(--success))',
          muted: 'hsl(var(--success-muted))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          muted: 'hsl(var(--warning-muted))',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger))',
          muted: 'hsl(var(--danger-muted))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          muted: 'hsl(var(--info-muted))',
        },
        surface: {
          DEFAULT: 'hsl(var(--surface-1))',
          0: 'hsl(var(--surface-0))',
          1: 'hsl(var(--surface-1))',
          2: 'hsl(var(--surface-2))',
          3: 'hsl(var(--surface-3))',
        },
        zinc: {
          50: 'hsl(var(--zinc-50))',
          100: 'hsl(var(--zinc-100))',
          200: 'hsl(var(--zinc-200))',
          300: 'hsl(var(--zinc-300))',
          400: 'hsl(var(--zinc-400))',
          500: 'hsl(var(--zinc-500))',
          600: 'hsl(var(--zinc-600))',
          700: 'hsl(var(--zinc-700))',
          800: 'hsl(var(--zinc-800))',
          900: 'hsl(var(--zinc-900))',
          950: 'hsl(var(--zinc-950))',
        },
        gray: {
          750: '#2d3748',
          850: '#1a202c',
          950: '#0d1117',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
      },
      boxShadow: {
        'surface-light': 'var(--shadow-surface)',
        'surface-dark': 'var(--shadow-surface)',
        elevated: 'var(--shadow-elevated)',
        'elevated-dark': 'var(--shadow-elevated)',
        panel: 'var(--shadow-panel)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-up': 'fade-up 0.2s var(--ease-standard)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
