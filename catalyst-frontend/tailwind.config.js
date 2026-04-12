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
        sans: ['Outfit', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Cascadia Code', 'Fira Code', 'monospace'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover: 'hsl(var(--primary-hover))',
          // Backward-compatible aliases
          50: 'hsl(174 88% 95%)',
          100: 'hsl(174 88% 90%)',
          200: 'hsl(174 88% 80%)',
          300: 'hsl(174 88% 70%)',
          400: 'hsl(174 88% 60%)',
          500: 'hsl(var(--primary))',
          600: 'hsl(var(--primary))',
          700: 'hsl(174 88% 30%)',
          800: 'hsl(174 88% 20%)',
          900: 'hsl(174 88% 10%)',
        },
        'primary-foreground': 'hsl(var(--primary-foreground))',
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        'accent-foreground': 'hsl(var(--accent-foreground))',
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        ring: 'hsl(var(--ring))',
        surface: {
          0: 'hsl(var(--surface-0))',
          1: 'hsl(var(--surface-1))',
          2: 'hsl(var(--surface-2))',
          3: 'hsl(var(--surface-3))',
        },
        // Backward-compatible slate scale (maps to design system)
        slate: {
          50: 'hsl(var(--surface-1))',
          100: 'hsl(var(--surface-1))',
          200: 'hsl(var(--surface-2))',
          300: 'hsl(var(--surface-3))',
          400: 'hsl(var(--muted-foreground))',
          500: 'hsl(var(--muted-foreground))',
          600: 'hsl(var(--muted-foreground))',
          700: 'hsl(224 25% 27%)',
          800: 'hsl(224 30% 14%)',
          900: 'hsl(222 47% 11%)',
          950: 'hsl(224 40% 5%)',
        },
        gray: {
          750: 'hsl(224 25% 22%)',
          850: 'hsl(224 36% 10%)',
          950: 'hsl(224 40% 5%)',
        },
        brand: {
          yellow: 'hsl(38 92% 50%)',
          magenta: 'hsl(308 67% 56%)',
          cyan: 'hsl(189 100% 50%)',
          violet: 'hsl(273 71% 39%)',
          blue: 'hsl(216 100% 50%)',
          black: 'hsl(224 60% 5%)',
        },
        sky: {
          50: 'hsl(174 88% 95%)',
          100: 'hsl(174 88% 90%)',
          200: 'hsl(174 88% 80%)',
          300: 'hsl(174 88% 70%)',
          400: 'hsl(174 88% 60%)',
          500: 'hsl(var(--primary))',
          600: 'hsl(174 88% 46%)',
          700: 'hsl(174 88% 38%)',
          800: 'hsl(174 82% 30%)',
          900: 'hsl(174 75% 22%)',
        },
      },
      borderRadius: {
        lg: '0.625rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
      boxShadow: {
        'surface': '0 1px 2px 0 hsl(var(--border) / 0.5)',
        'surface-md': '0 2px 8px -2px hsl(var(--foreground) / 0.06), 0 1px 3px -1px hsl(var(--foreground) / 0.04)',
        'surface-lg': '0 4px 16px -4px hsl(var(--foreground) / 0.08), 0 2px 6px -2px hsl(var(--foreground) / 0.04)',
        'surface-light': '0 1px 2px 0 hsl(var(--border) / 0.5)',
        'surface-dark': '0 1px 2px 0 hsl(var(--border) / 0.5)',
        'glow': '0 0 20px -4px hsl(var(--primary) / 0.3)',
        'glow-lg': '0 0 40px -8px hsl(var(--primary) / 0.25)',
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
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in': 'slide-in 0.2s ease-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
