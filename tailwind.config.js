/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html','./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    // Declared OUTSIDE `extend` on purpose: it replaces Tailwind's radius
    // scale, so every rounded-* class already written follows it in one move.
    // v2 (2026-10-19): small radii, as shadcn/ui and the products it is
    // modelled on (Vercel, Linear, Attio). v1 set every value to 0 for a
    // boxy look; the owner found the result "weird" (2026-10-19). Kept modest so the ~470
    // rounded-* classes v1's pages still carry round gently, not into pills.
    // `full` stays for what is truly round: avatars, dots, spinners.
    borderRadius: {
      none:    '0px',
      sm:      '4px',
      DEFAULT: '6px',
      md:      '6px',
      lg:      '8px',
      xl:      '10px',
      '2xl':   '12px',
      '3xl':   '12px',
      '4xl':   '12px',
      full:    '9999px',
    },
    extend: {
      fontFamily: {
        // Inter: the face of most clean professional software (Linear,
        // Attio, Vercel's dashboards, shadcn/ui's examples). Arabic falls
        // through to IBM Plex Sans Arabic, since Inter has no Arabic glyphs
        // and the CEO reads the app in Arabic.
        sans: ['Inter', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
      },
      // ── v2 palette (2026-10-19): neutral, shadcn/ui-style ──
      // Researched on the owner's request ("look on the internet for simple,
      // clean, professional ones with a similar format"). The reference is
      // shadcn/ui's sidebar blocks (an icon rail beside a second panel, the
      // same layout as ours), in the lineage of Linear, Stripe and Attio.
      // Their shared rules: a light, quiet frame; neutral greys; near-black
      // for the primary action; colour only for state. The black-and-gold
      // first try was rejected.
      //
      // The class NAMES stay what ~140 files already use; their values
      // change, so every page takes the look without edits:
      //   amber = v1's accent scale, now neutral. Its light end (50–300) is
      //           the soft grey of hover and selection; its dark end (700–
      //           900) is the near-black of primary buttons and toggles.
      //           It no longer means "warning": state uses Tailwind's own
      //           yellow / red / green.
      //   stone, clay = Tailwind's neutral greys.
      //   sage  = unchanged: green means "good".
      colors: {
        amber: {
          50:  '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#18181b',
          800: '#09090b',
          900: '#09090b',
        },
        stone: {
          50:  '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },
        clay: {
          50:  '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#27272a',
          800: '#18181b',
          900: '#09090b',
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
          muted:   '#fafafa',   // the frame: rail, section menu, page behind the panel
          subtle:  '#f4f4f5',   // hover, selected rows
          card:    '#ffffff',
          warm:    '#fafafa',
        },
        border: {
          DEFAULT: '#e4e4e7',
          strong:  '#d4d4d8',
          light:   '#f4f4f5',
        },
        text: {
          DEFAULT:   '#09090b',
          secondary: '#52525b',
          tertiary:  '#71717a',   // 4.8:1 on white
          disabled:  '#a1a1aa',
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
        'dropdown':  '0 10px 30px rgba(9,9,11,0.08), 0 2px 6px rgba(9,9,11,0.05)',
        'inset':     'none',
      },
      backgroundImage: {
        // No gradients in v2, the logo mark included. The *-gradient names
        // stay so existing call sites keep working; each paints one colour.
        'logo-mark':      'linear-gradient(#18181b, #18181b)',
        'amber-gradient': 'linear-gradient(#18181b, #18181b)',
        'clay-gradient':  'linear-gradient(#27272a, #27272a)',
        'warm-gradient':  'linear-gradient(#fafafa, #fafafa)',
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
