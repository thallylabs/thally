const config = {
  plugins: {
    // optimize in development to discard invalid utility candidates from prose.
    '@tailwindcss/postcss': {
      optimize: { minify: process.env.NODE_ENV === 'production' },
    },
  },
}

export default config
