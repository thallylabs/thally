import { execSync } from 'node:child_process'
import { basename } from 'node:path'

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function run(cmd: string, cwd?: string): void {
  execSync(cmd, { cwd, stdio: 'inherit' })
}

export function runSilent(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8' }).trim()
}

export function initGit(targetDir: string): void {
  try {
    run('git init', targetDir)
    run('git add -A', targetDir)
    run('git commit -m "Initial commit from create-dox"', targetDir)
  } catch {
    console.log('  ⚠️  Could not initialize git (you can do this manually).')
  }
}

export function installDeps(targetDir: string): void {
  console.log('')
  console.log('  📦 Installing dependencies...')
  console.log('')
  run('npm install', targetDir)
}

export function logo(): void {
  console.log('')
  console.log('  ╔══════════════════════════════════════╗')
  console.log('  ║                                      ║')
  console.log('  ║       ██████╗  ██████╗ ██╗  ██╗      ║')
  console.log('  ║       ██╔══██╗██╔═══██╗╚██╗██╔╝      ║')
  console.log('  ║       ██║  ██║██║   ██║ ╚███╔╝       ║')
  console.log('  ║       ██║  ██║██║   ██║ ██╔██╗       ║')
  console.log('  ║       ██████╔╝╚██████╔╝██╔╝ ██╗      ║')
  console.log('  ║       ╚═════╝  ╚═════╝ ╚═╝  ╚═╝      ║')
  console.log('  ║                                      ║')
  console.log('  ║   Beautiful docs, zero lock-in.      ║')
  console.log('  ║                                      ║')
  console.log('  ╚══════════════════════════════════════╝')
  console.log('')
}

export function success(projectDir: string, projectName: string): void {
  console.log('')
  console.log('  ✅ Your Dox project is ready!')
  console.log('')
  console.log(`  📂 ${projectDir}`)
  console.log('')
  console.log('  Next steps:')
  console.log('')
  console.log(`    cd ${basename(projectDir)}`)
  console.log('    npm run dev')
  console.log('')
  console.log(`  Then open http://localhost:3040 to see your ${projectName} docs.`)
  console.log('')
  console.log('  📝 Key files to edit:')
  console.log('    • src/data/site.ts        — name, links, branding')
  console.log('    • docs.json               — navigation structure')
  console.log('    • src/content/*.mdx        — your documentation')
  console.log('    • openapi.yaml            — API spec (optional)')
  console.log('')
  console.log('  Happy documenting! 🚀')
  console.log('')
}
