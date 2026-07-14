import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/app/**/*.{ts,tsx,mdx}',
    './src/components/**/*.{ts,tsx,mdx}',
    './src/content/**/*.{mdx,md}',
    './src/data/**/*.{ts,tsx}',
    './src/config/**/*.{ts,tsx}',
    './mdx-components.tsx',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        heading: ['var(--font-heading)', 'var(--font-display)', 'var(--font-sans)', 'Plus Jakarta Sans', 'Inter', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'IBM Plex Mono', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1.25rem' }],
      },
      // Wire Tailwind's radius scale to the structural-theme vars so the theme
      // (default/maple/sharp/minimal) actually reshapes cards/panels/buttons, not
      // just the sidebar. Defaults equal Tailwind's originals, so nothing shifts
      // until a non-default theme sets the --theme-radius-* overrides.
      borderRadius: {
        md: 'var(--theme-radius-sm)', // 0.375rem
        lg: 'var(--theme-radius-md)', // 0.5rem
        xl: 'calc((var(--theme-radius-md) + var(--theme-radius-lg)) / 2)', // 0.75rem
        '2xl': 'var(--theme-radius-lg)', // 1rem
        '3xl': 'var(--theme-radius-xl)', // 1.5rem
      },
      colors: {
        background: 'hsl(var(--thally-background) / <alpha-value>)',
        card: 'hsl(var(--thally-card) / <alpha-value>)',
        foreground: 'hsl(var(--thally-foreground) / <alpha-value>)',
        muted: 'hsl(var(--thally-muted) / <alpha-value>)',
        'muted-foreground': 'hsl(var(--thally-muted-foreground) / <alpha-value>)',
        border: 'hsl(var(--thally-border) / <alpha-value>)',
        accent: 'hsl(var(--thally-accent) / <alpha-value>)',
        'accent-foreground': 'hsl(var(--thally-accent-foreground) / <alpha-value>)',
        'accent-2': 'hsl(var(--thally-accent-2) / <alpha-value>)',
        'accent-2-foreground': 'hsl(var(--thally-accent-2-foreground) / <alpha-value>)',
        input: 'hsl(var(--thally-input) / <alpha-value>)',
        sidebar: 'hsl(var(--thally-sidebar) / <alpha-value>)',
        primary: 'hsl(var(--thally-primary) / <alpha-value>)',
        'primary-foreground': 'hsl(var(--thally-primary-foreground) / <alpha-value>)',
        ring: 'hsl(var(--thally-ring) / <alpha-value>)',
      },
      boxShadow: {
        focus: '0 0 0 2px hsl(var(--thally-ring) / 0.4)',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typography: ({ theme }: { theme: any }) => ({
        DEFAULT: {
          css: {
            // Prose neutrals derive from the brand foreground/border tokens
            // (warm green-tinted ink by default) so a rebrand re-tints the
            // reading surface automatically instead of leaving cool zinc.
            '--tw-prose-body': 'hsl(var(--thally-foreground) / 0.84)',
            '--tw-prose-headings': 'hsl(var(--thally-foreground))',
            '--tw-prose-links': 'hsl(var(--thally-accent))',
            '--tw-prose-links-hover': 'hsl(var(--thally-accent) / 0.85)',
            '--tw-prose-links-underline': 'hsl(var(--thally-accent) / 0.3)',
            '--tw-prose-strong': 'hsl(var(--thally-foreground))',
            '--tw-prose-bold': 'hsl(var(--thally-foreground))',
            '--tw-prose-counters': 'hsl(var(--thally-foreground) / 0.55)',
            '--tw-prose-bullets': 'hsl(var(--thally-foreground) / 0.3)',
            '--tw-prose-hr': 'hsl(var(--thally-foreground) / 0.06)',
            '--tw-prose-quotes': 'hsl(var(--thally-foreground))',
            '--tw-prose-quote-borders': 'hsl(var(--thally-border))',
            '--tw-prose-captions': 'hsl(var(--thally-foreground) / 0.55)',
            '--tw-prose-code': 'hsl(var(--thally-foreground))',
            '--tw-prose-code-bg': 'hsl(var(--thally-muted) / 0.7)',
            '--tw-prose-code-ring': 'hsl(var(--thally-border))',
            '--tw-prose-th-borders': 'hsl(var(--thally-border))',
            '--tw-prose-td-borders': 'hsl(var(--thally-border) / 0.7)',
            '--tw-prose-invert-body': 'hsl(var(--thally-foreground) / 0.78)',
            '--tw-prose-invert-headings': 'hsl(var(--thally-foreground))',
            '--tw-prose-invert-links': 'hsl(var(--thally-accent))',
            '--tw-prose-invert-links-hover': 'hsl(var(--thally-accent) / 0.85)',
            '--tw-prose-invert-links-underline': 'hsl(var(--thally-accent) / 0.3)',
            '--tw-prose-invert-bold': 'hsl(var(--thally-foreground))',
            '--tw-prose-invert-counters': 'hsl(var(--thally-foreground) / 0.6)',
            '--tw-prose-invert-bullets': 'hsl(var(--thally-foreground) / 0.35)',
            '--tw-prose-invert-hr': 'hsl(var(--thally-foreground) / 0.06)',
            '--tw-prose-invert-quotes': 'hsl(var(--thally-foreground) / 0.95)',
            '--tw-prose-invert-quote-borders': 'hsl(var(--thally-border))',
            '--tw-prose-invert-captions': 'hsl(var(--thally-foreground) / 0.6)',
            '--tw-prose-invert-code': 'hsl(var(--thally-foreground))',
            '--tw-prose-invert-code-bg': 'hsl(var(--thally-muted) / 0.6)',
            '--tw-prose-invert-code-ring': 'hsl(var(--thally-border))',
            '--tw-prose-invert-th-borders': 'hsl(var(--thally-border))',
            '--tw-prose-invert-td-borders': 'hsl(var(--thally-border) / 0.7)',
            color: 'var(--tw-prose-body)',
            // 15px base with a relaxed measure reads more premium than the
            // former 14px (fontSize.sm) on wide docs columns.
            fontSize: '0.9375rem',
            lineHeight: '1.7',
            p: {
              marginTop: theme('spacing.6'),
              marginBottom: theme('spacing.6'),
            },
            '[class~="lead"]': {
              fontSize: theme('fontSize.base')[0],
              ...theme('fontSize.base')[1],
            },
            ol: {
              listStyleType: 'decimal',
              marginTop: theme('spacing.5'),
              marginBottom: theme('spacing.5'),
              paddingLeft: '1.625rem',
            },
            'ol[type="A"]': {
              listStyleType: 'upper-alpha',
            },
            'ol[type="a"]': {
              listStyleType: 'lower-alpha',
            },
            'ol[type="A" s]': {
              listStyleType: 'upper-alpha',
            },
            'ol[type="a" s]': {
              listStyleType: 'lower-alpha',
            },
            'ol[type="I"]': {
              listStyleType: 'upper-roman',
            },
            'ol[type="i"]': {
              listStyleType: 'lower-roman',
            },
            'ol[type="I" s]': {
              listStyleType: 'upper-roman',
            },
            'ol[type="i" s]': {
              listStyleType: 'lower-roman',
            },
            'ol[type="1"]': {
              listStyleType: 'decimal',
            },
            ul: {
              listStyleType: 'disc',
              marginTop: theme('spacing.5'),
              marginBottom: theme('spacing.5'),
              paddingLeft: '1.625rem',
            },
            li: {
              marginTop: theme('spacing.2'),
              marginBottom: theme('spacing.2'),
            },
            ':is(ol, ul) > li': {
              paddingLeft: theme('spacing[1.5]'),
            },
            'ol > li::marker': {
              fontWeight: '400',
              color: 'var(--tw-prose-counters)',
            },
            'ul > li::marker': {
              color: 'var(--tw-prose-bullets)',
            },
            '> ul > li p': {
              marginTop: theme('spacing.3'),
              marginBottom: theme('spacing.3'),
            },
            '> ul > li > *:first-child': {
              marginTop: theme('spacing.5'),
            },
            '> ul > li > *:last-child': {
              marginBottom: theme('spacing.5'),
            },
            '> ol > li > *:first-child': {
              marginTop: theme('spacing.5'),
            },
            '> ol > li > *:last-child': {
              marginBottom: theme('spacing.5'),
            },
            'ul ul, ul ol, ol ul, ol ol': {
              marginTop: theme('spacing.3'),
              marginBottom: theme('spacing.3'),
            },
            hr: {
              borderColor: 'var(--tw-prose-hr)',
              borderTopWidth: 1,
              marginTop: theme('spacing.16'),
              marginBottom: theme('spacing.16'),
              maxWidth: 'none',
              marginLeft: `calc(-1 * ${theme('spacing.4')})`,
              marginRight: `calc(-1 * ${theme('spacing.4')})`,
              '@screen sm': {
                marginLeft: `calc(-1 * ${theme('spacing.6')})`,
                marginRight: `calc(-1 * ${theme('spacing.6')})`,
              },
              '@screen lg': {
                marginLeft: `calc(-1 * ${theme('spacing.8')})`,
                marginRight: `calc(-1 * ${theme('spacing.8')})`,
              },
            },
            blockquote: {
              fontWeight: '500',
              fontStyle: 'italic',
              color: 'var(--tw-prose-quotes)',
              borderLeftWidth: '0.25rem',
              borderLeftColor: 'var(--tw-prose-quote-borders)',
              quotes: '"\\201C""\\201D""\\2018""\\2019"',
              marginTop: theme('spacing.8'),
              marginBottom: theme('spacing.8'),
              paddingLeft: theme('spacing.5'),
            },
            'blockquote p:first-of-type::before': {
              content: 'open-quote',
            },
            'blockquote p:last-of-type::after': {
              content: 'close-quote',
            },
            'h1, h2, h3, h4, h5, h6': {
              fontFamily: 'var(--font-heading)',
            },
            // Single source of truth for the docs heading scale. The MDX
            // heading components intentionally set no font-size/weight so
            // this config styles every heading, MDX or plain markdown.
            h1: {
              color: 'var(--tw-prose-headings)',
              fontWeight: '600',
              letterSpacing: '-0.02em',
              fontSize: theme('fontSize.3xl')[0],
              ...theme('fontSize.3xl')[1],
              marginBottom: theme('spacing.2'),
            },
            h2: {
              color: 'var(--tw-prose-headings)',
              fontWeight: '600',
              letterSpacing: '-0.02em',
              fontSize: theme('fontSize.2xl')[0],
              ...theme('fontSize.2xl')[1],
              marginTop: theme('spacing.16'),
              marginBottom: theme('spacing.2'),
            },
            h3: {
              color: 'var(--tw-prose-headings)',
              fontSize: theme('fontSize.xl')[0],
              ...theme('fontSize.xl')[1],
              fontWeight: '600',
              letterSpacing: '-0.015em',
              marginTop: theme('spacing.10'),
              marginBottom: theme('spacing.2'),
            },
            'img, video, figure': {
              marginTop: theme('spacing.8'),
              marginBottom: theme('spacing.8'),
            },
            'figure > *': {
              marginTop: '0',
              marginBottom: '0',
            },
            figcaption: {
              color: 'var(--tw-prose-captions)',
              fontSize: theme('fontSize.xs')[0],
              ...theme('fontSize.xs')[1],
              marginTop: theme('spacing.2'),
            },
            table: {
              width: '100%',
              tableLayout: 'auto',
              textAlign: 'left',
              marginTop: theme('spacing.8'),
              marginBottom: theme('spacing.8'),
              lineHeight: theme('lineHeight.6'),
            },
            thead: {
              borderBottomWidth: '1px',
              borderBottomColor: 'var(--tw-prose-th-borders)',
            },
            'thead th': {
              color: 'var(--tw-prose-headings)',
              fontWeight: '600',
              verticalAlign: 'bottom',
              paddingRight: theme('spacing.2'),
              paddingBottom: theme('spacing.2'),
              paddingLeft: theme('spacing.2'),
            },
            'thead th:first-child': {
              paddingLeft: '0',
            },
            'thead th:last-child': {
              paddingRight: '0',
            },
            'tbody tr': {
              borderBottomWidth: '1px',
              borderBottomColor: 'var(--tw-prose-td-borders)',
            },
            'tbody tr:last-child': {
              borderBottomWidth: '0',
            },
            'tbody td': {
              verticalAlign: 'baseline',
            },
            tfoot: {
              borderTopWidth: '1px',
              borderTopColor: 'var(--tw-prose-th-borders)',
            },
            'tfoot td': {
              verticalAlign: 'top',
            },
            ':is(tbody, tfoot) td': {
              paddingTop: theme('spacing.2'),
              paddingRight: theme('spacing.2'),
              paddingBottom: theme('spacing.2'),
              paddingLeft: theme('spacing.2'),
            },
            ':is(tbody, tfoot) td:first-child': {
              paddingLeft: '0',
            },
            ':is(tbody, tfoot) td:last-child': {
              paddingRight: '0',
            },
            a: {
              color: 'var(--tw-prose-links)',
              textDecoration: 'underline transparent',
              fontWeight: '500',
              transitionProperty: 'color, text-decoration-color',
              transitionDuration: theme('transitionDuration.DEFAULT'),
              transitionTimingFunction: theme(
                'transitionTimingFunction.DEFAULT',
              ),
              '&:hover': {
                color: 'var(--tw-prose-links-hover)',
                textDecorationColor: 'var(--tw-prose-links-underline)',
              },
            },
            ':is(h1, h2, h3) a': {
              fontWeight: 'inherit',
            },
            strong: {
              color: 'var(--tw-prose-bold)',
              fontWeight: '600',
            },
            ':is(a, blockquote, thead th) strong': {
              color: 'inherit',
            },
            code: {
              color: 'var(--tw-prose-code)',
              borderRadius: theme('borderRadius.lg'),
              paddingTop: theme('spacing.1'),
              paddingRight: theme('spacing[1.5]'),
              paddingBottom: theme('spacing.1'),
              paddingLeft: theme('spacing[1.5]'),
              boxShadow: 'inset 0 0 0 1px var(--tw-prose-code-ring)',
              backgroundColor: 'var(--tw-prose-code-bg)',
              fontSize: theme('fontSize.2xs')[0],
            },
            'code::before': {
              content: 'none',
            },
            'code::after': {
              content: 'none',
            },
            ':is(a, h1, h2, h3, blockquote, thead th) code': {
              color: 'inherit',
            },
            'h2 code': {
              fontSize: theme('fontSize.lg')[0],
              fontWeight: 'inherit',
            },
            'h3 code': {
              fontSize: theme('fontSize.base')[0],
              fontWeight: 'inherit',
            },
            ':is(h1, h2, h3) + *': {
              marginTop: '0',
            },
            '> :first-child': {
              marginTop: '0 !important',
            },
            '> :last-child': {
              marginBottom: '0 !important',
            },
          },
        },
        invert: {
          css: {
            '--tw-prose-body': 'var(--tw-prose-invert-body)',
            '--tw-prose-headings': 'var(--tw-prose-invert-headings)',
            '--tw-prose-links': 'var(--tw-prose-invert-links)',
            '--tw-prose-links-hover': 'var(--tw-prose-invert-links-hover)',
            '--tw-prose-links-underline':
              'var(--tw-prose-invert-links-underline)',
            '--tw-prose-bold': 'var(--tw-prose-invert-bold)',
            '--tw-prose-counters': 'var(--tw-prose-invert-counters)',
            '--tw-prose-bullets': 'var(--tw-prose-invert-bullets)',
            '--tw-prose-hr': 'var(--tw-prose-invert-hr)',
            '--tw-prose-quotes': 'var(--tw-prose-invert-quotes)',
            '--tw-prose-quote-borders':
              'var(--tw-prose-invert-quote-borders)',
            '--tw-prose-captions': 'var(--tw-prose-invert-captions)',
            '--tw-prose-code': 'var(--tw-prose-invert-code)',
            '--tw-prose-code-bg': 'var(--tw-prose-invert-code-bg)',
            '--tw-prose-code-ring': 'var(--tw-prose-invert-code-ring)',
            '--tw-prose-th-borders': 'var(--tw-prose-invert-th-borders)',
            '--tw-prose-td-borders': 'var(--tw-prose-invert-td-borders)',
          },
        },
      }),
    },
  },
  plugins: [typography],
}

export default config
