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
        // One Latin family. Arabic falls through to IBM Plex Sans Arabic
        // (loaded in src/index.css) rather than whatever the system has: DM
        // Sans has no Arabic glyphs, and the CEO reads the app in Arabic.
        sans: ['"DM Sans"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
      },
      // ── v2 palette (2026-10-19): Arak's own identity ──
      // Brand Brain, Arak: near-black #0A0A0A, warm cream #FEFBF6, mid grey
      // #828182, and "the only accent colour is the light itself: a warm
      // amber/gold glow". So the UI is warm neutrals, near-black for anything
      // strong, and gold used sparingly. No gradients, no glow, no purple.
      //
      // The class NAMES stay what ~140 files already use; their values
      // change:
      //   amber  = the accent scale. Its light end (50–600) is the gold
      //            light: highlights, markers, warnings, focus borders. Its
      //            dark end (700–900) is ink, because v1 used amber-700 as
      //            "the primary action": primary buttons, toggles, selected
      //            chips and links become near-black, which is cleaner than
      //            a gold or a steel fill.
      //   stone  = warm neutral greys (Tailwind's own stone family).
      //   clay   = the secondary dark, now the same warm neutrals.
      //   sage   = unchanged: green means "good" whatever the brand.
      colors: {
        amber: {
          50:  '#fdf9f1',
          100: '#faf0dc',
          200: '#f2ddb2',
          300: '#e6c27c',
          400: '#d9a54c',
          500: '#c68a2c',
          600: '#9a6a20',
          700: '#1c1917',
          800: '#0c0a09',
          900: '#0a0a0a',
        },
        stone: {
          50:  '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
          950: '#0c0a09',
        },
        clay: {
          50:  '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#292524',
          800: '#1c1917',
          900: '#0c0a09',
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
          muted:   '#f7f6f3',   // the page: Arak's cream, a step darker so white cards read
          subtle:  '#fafaf8',   // hover and table stripes
          card:    '#ffffff',
          warm:    '#fefbf6',   // Arak's cream itself
        },
        border: {
          DEFAULT: '#e7e5e0',
          strong:  '#d6d3d1',
          light:   '#f0eeea',
        },
        text: {
          DEFAULT:   '#1c1917',
          secondary: '#57534e',
          tertiary:  '#78716c',   // 4.8:1 on white, so small print stays readable
          disabled:  '#a8a29e',
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
        'dropdown':  '0 8px 24px rgba(12,10,9,0.10), 0 2px 6px rgba(12,10,9,0.06)',
        'inset':     'none',
      },
      backgroundImage: {
        // No gradients in v2, the logo mark included: Arak's mark is a solid
        // near-black square. The *-gradient names stay so existing call
        // sites keep working; each paints one colour.
        'logo-mark':      'linear-gradient(#0a0a0a, #0a0a0a)',
        'amber-gradient': 'linear-gradient(#1c1917, #1c1917)',
        'clay-gradient':  'linear-gradient(#292524, #292524)',
        'warm-gradient':  'linear-gradient(#fefbf6, #fefbf6)',
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
