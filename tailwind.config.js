/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html','./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    // Declared OUTSIDE `extend` on purpose: this replaces Tailwind's radius
    // scale rather than adding to it, so every `rounded-*` class already
    // written across the app collapses to a square corner in one move. That
    // matters at this size — there are ~470 rounded-* usages across 25 pages,
    // and chasing them by hand would guarantee a few stragglers keeping their
    // pill shape on some page nobody reopened.
    //
    // `full` is the one deliberate exception. It survives because some things
    // are genuinely circular and would look broken squared off: avatars,
    // status dots, and spinners. Anything that is a *box* — cards, buttons,
    // inputs, modals, badges, tags — must not use it.
    borderRadius: {
      none:    '0px',
      sm:      '0px',
      DEFAULT: '0px',
      md:      '0px',
      lg:      '0px',
      xl:      '0px',
      '2xl':   '0px',
      '3xl':   '0px',
      '4xl':   '0px',
      full:    '9999px',
    },
    extend: {
      fontFamily: {
        // One family. `display` is deliberately absent — see the note in
        // src/index.css; nothing referenced it after the boxy pass, and a
        // half-wired font utility is worse than no utility.
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Primary accent — was warm amber/sand, now Cool Steel
        amber: {
          50:  '#eef1ef',
          100: '#e1e7e6',
          200: '#c8d3d5',
          300: '#afc0c4',
          400: '#96acb2',
          500: '#7d98a1',
          600: '#657b81',
          700: '#4c5e61',
          800: '#344041',
          900: '#1c2321',
        },
        // Neutral — was warm stone/tan, now a cool Powder-Blue-to-Carbon grey
        stone: {
          50:  '#eef1ef',
          100: '#e0e5e6',
          200: '#c5ccd4',
          300: '#a9b4c2',
          400: '#929ca7',
          500: '#7a848c',
          600: '#626c72',
          700: '#4b5357',
          800: '#343b3c',
          900: '#1c2321',
        },
        // Secondary accent — was terracotta/clay, now Blue Slate
        clay: {
          50:  '#eef1ef',
          100: '#dee1e1',
          200: '#bec2c5',
          300: '#9ea3aa',
          400: '#7e848e',
          500: '#5e6572',
          600: '#4e545e',
          700: '#3d444a',
          800: '#2c3435',
          900: '#1c2321',
        },
        // Sage stays untouched — Approved/Published/Live status colors carry
        // usability meaning (green = good) independent of brand color.
        sage: {
          50:  '#f4f7f2',
          100: '#e5ede0',
          200: '#c9dac0',
          300: '#a3bf97',
          400: '#779e6a',
          500: '#558050',
          600: '#40673d',
          700: '#325130',
          800: '#263e25',
          900: '#1c2d1c',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted:   '#eef1ef',
          subtle:  '#f3f5f4',
          card:    '#ffffff',
          warm:    '#f6f8f7',
        },
        border: {
          DEFAULT: '#dde3e2',
          strong:  '#a9b4c2',
          light:   '#e9eceb',
        },
        text: {
          DEFAULT:   '#1c2321',
          secondary: '#5e6572',
          tertiary:  '#7d98a1',
          disabled:  '#a9b4c2',
        },
      },
      boxShadow: {
        // Elevation is not part of this design language — structure comes from
        // 1px rules, not from lift. `card` and the accent shadows are kept as
        // names (they're referenced in ~60 places) but resolve to nothing, so
        // a stray `shadow-card` can't reintroduce a float. Only genuinely
        // floating surfaces — dropdowns, popovers, modals — cast a shadow,
        // because there the shadow carries meaning: "this is above the page."
        'sm':        'none',
        'card':      'none',
        'card-hover':'none',
        'amber':     'none',
        'amber-lg':  'none',
        'clay':      'none',
        'dropdown':  '0 8px 24px rgba(28,35,33,0.10), 0 2px 6px rgba(28,35,33,0.06)',
        'inset':     'none',
      },
      backgroundImage: {
        // One gradient survives the flattening: the logo mark. It's the single
        // brand signature in an otherwise flat UI, so it reads as intentional
        // rather than leftover. Everything else resolves to a solid fill —
        // the *-gradient names stay so existing `bg-amber-gradient` call sites
        // keep working, they just paint one color now.
        'logo-mark':      'linear-gradient(135deg, #7d98a1 0%, #344041 100%)',
        'amber-gradient': 'linear-gradient(#4c5e61, #4c5e61)',
        'clay-gradient':  'linear-gradient(#3d444a, #3d444a)',
        'warm-gradient':  'linear-gradient(#eef1ef, #eef1ef)',
        'card-warm':      'linear-gradient(#ffffff, #ffffff)',
        'hero-warm':      'none',
        'sidebar-warm':   'linear-gradient(#ffffff, #ffffff)',
      },
      animation: {
        'shimmer':     'shimmer 2.5s ease-in-out infinite',
        'float':       'float 5s ease-in-out infinite',
        'fade-up':     'fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) both',
        'slide-up':    'slideUp 0.45s cubic-bezier(0.16,1,0.3,1) both',
        'fade-scale':  'fadeScale 0.3s cubic-bezier(0.16,1,0.3,1) both',
        'stagger-1':   'slideUp 0.5s 0.05s cubic-bezier(0.16,1,0.3,1) both',
        'stagger-2':   'slideUp 0.5s 0.10s cubic-bezier(0.16,1,0.3,1) both',
        'stagger-3':   'slideUp 0.5s 0.15s cubic-bezier(0.16,1,0.3,1) both',
        'stagger-4':   'slideUp 0.5s 0.20s cubic-bezier(0.16,1,0.3,1) both',
        'pulse-dot':   'pulseDot 2s ease-in-out infinite',
      },
      keyframes: {
        shimmer:  { '0%,100%': { backgroundPosition: '-200% 0' }, '50%': { backgroundPosition: '200% 0' } },
        float:    { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-5px)' } },
        fadeUp:   { from: { opacity:'0', transform:'translateY(8px)' }, to: { opacity:'1', transform:'translateY(0)' } },
        slideUp:  { from: { opacity:'0', transform:'translateY(14px)' }, to: { opacity:'1', transform:'translateY(0)' } },
        fadeScale:{ from: { opacity:'0', transform:'scale(0.97)' }, to: { opacity:'1', transform:'scale(1)' } },
        pulseDot: { '0%,100%': { opacity:'1', transform:'scale(1)' }, '50%': { opacity:'0.5', transform:'scale(0.8)' } },
      },
    },
  },
  plugins: [],
}
