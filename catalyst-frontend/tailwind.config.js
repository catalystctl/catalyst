import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
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
          50: 'hsl(174 80% 95%)',
          100: 'hsl(174 72% 90%)',
          200: 'hsl(174 72% 80%)',
          300: 'hsl(174 72% 70%)',
          400: 'hsl(174 80% 56%)',
          500: 'hsl(174 80% 46%)',
          600: 'hsl(174 80% 40%)',
          700: 'hsl(174 80% 32%)',
          800: 'hsl(174 80% 24%)',
          900: 'hsl(174 80% 16%)',
          950: 'hsl(174 80% 8%)',
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
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        'surface-light': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'surface-dark': '0 1px 2px 0 rgb(0 0 0 / 0.3)',
        'elevated': '0 4px 12px -2px rgb(0 0 0 / 0.1)',
        'elevated-dark': '0 4px 12px -2px rgb(0 0 0 / 0.5)',
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
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
