import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist', { recursive: true })
copyFileSync('src/index.js', 'dist/index.js')
console.log('✓ Built dist/index.js')
