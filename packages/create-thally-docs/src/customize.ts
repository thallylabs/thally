import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const STARTER_PAGES: Record<string, string> = {
  'introduction.mdx': `---
title: Introduction
description: Welcome to {NAME}.
mode: home
keywords:
  - {NAME}
  - documentation
  - overview
  - getting started
---

<Hero
  title="Welcome to {NAME}"
  subtitle="Use this starter to introduce your product, guide readers to their first successful outcome, and publish a clear API reference."
  primaryLabel="Start the quickstart"
  primaryHref="/quickstart"
  secondaryLabel="See components"
  secondaryHref="/components"
/>

<CardGroup cols={3}>
  <Card title="Quickstart" icon="party-horn" href="/quickstart">
    Show readers the fastest path to a useful first result.
  </Card>
  <Card title="Components" icon="grid-round" href="/components">
    Structure guides with steps, tabs, cards, callouts, accordions, and more.
  </Card>
  <Card title="API reference" icon="code-simple" href="/api">
    Replace \`openapi.yaml\` with your specification to publish interactive endpoints.
  </Card>
  <Card title="Customize" icon="wrench" href="/customization">
    Make the navigation, brand, typography, and links your own.
  </Card>
  <Card title="Multi-language" icon="message" href="/es">
    Switch to the included Spanish example from the language menu.
  </Card>
  <Card title="Agent-ready docs" icon="link-simple" href="/llms.txt">
    Give coding agents a clean, structured version of your documentation.
  </Card>
</CardGroup>

<Note type="info" title="Make it yours">
  Start by editing \`src/content/introduction.mdx\`. Then update \`docs.json\` to
  organize navigation and \`src/data/site.ts\` to set your product name and links.
</Note>
`,
  'quickstart.mdx': `---
title: Quickstart
description: Give readers the fastest path to a successful first result with {NAME}.
keywords:
  - {NAME}
  - quickstart
  - installation
  - getting started
---

Describe the prerequisites and the shortest useful workflow. A good quickstart
takes someone from zero to a visible result without explaining every option.

## Prerequisites

- Requirement one, such as an account, API key, or supported runtime
- Requirement two, such as a compatible device, browser, or operating system

<Steps>
  <Step title="Install">
    Explain how to install {NAME} or create an account.

    \`\`\`bash
    npm install your-package
    \`\`\`
  </Step>
  <Step title="Configure">
    Show only the configuration required for the first successful run.

    \`\`\`bash
    your-cli init
    \`\`\`
  </Step>
  <Step title="Run it">
    Give readers a command or action with an observable result.

    \`\`\`bash
    your-cli start
    \`\`\`
  </Step>
</Steps>

<Tip>
  Tell readers where to get help, then link to the next guide they should read.
</Tip>
`,
  'components.mdx': `---
title: Components
description: A compact tour of the rich MDX components available in {NAME}.
keywords:
  - {NAME}
  - components
  - MDX
---

Use components to keep complex instructions clear without turning every page
into a wall of text.

## Show equivalent paths

<Tabs>
  <Tab title="npm">
    \`\`\`bash
    npm install your-package
    \`\`\`
  </Tab>
  <Tab title="pnpm">
    \`\`\`bash
    pnpm add your-package
    \`\`\`
  </Tab>
  <Tab title="yarn">
    \`\`\`bash
    yarn add your-package
    \`\`\`
  </Tab>
</Tabs>

## Reveal detail when it matters

<Accordion title="Where should advanced configuration live?">
  Keep the default path visible and move optional detail into an accordion. This
  lets new readers move quickly without hiding information from experts.
</Accordion>

## Communicate status

<Badge variant="success">Stable</Badge>{" "}
<Badge variant="warning">Beta</Badge>{" "}
<Badge variant="info">New</Badge>

<Tip>
  Browse the complete component library at [docs.thally.io](https://docs.thally.io/components/card).
</Tip>
`,
  'customization.mdx': `---
title: Customization
description: Make {NAME} feel unmistakably like your product.
keywords:
  - {NAME}
  - branding
  - navigation
---

Your documentation should feel like part of the product—not a separate website.

<CardGroup cols={2}>
  <Card title="Brand and theme" icon="party-horn" href="https://docs.thally.io/guides/branding-and-theming">
    Configure colors, logos, favicons, typography, and light or dark presentation.
  </Card>
  <Card title="Navigation" icon="book-open" href="https://docs.thally.io/guides/configuring-navigation">
    Organize tabs, icon-labelled groups, pages, and external destinations in \`docs.json\`.
  </Card>
  <Card title="Domains" icon="link-simple" href="https://app.thally.io">
    Connect a custom domain from your site settings in Thally Cloud.
  </Card>
  <Card title="Analytics and feedback" icon="message" href="https://app.thally.io">
    Learn what readers need and collect feedback without third-party widgets.
  </Card>
</CardGroup>

<Note type="info" title="Start with docs.json">
  Navigation and portable presentation settings live in \`docs.json\`. Site
  identity and fallback brand values live in \`src/data/site.ts\`.
</Note>
`,
  'changelog.mdx': `---
title: Changelog
description: Notable changes, releases, and improvements to {NAME}.
keywords:
  - {NAME}
  - changelog
  - releases
  - updates
---

## v0.1.0

The first release of your **{NAME}** documentation.

- Initial docs site scaffolded with [Thally](https://github.com/thallylabs/thally)
- Agent-ready endpoints live: \`/llms.txt\`, \`/ai.txt\`, \`/api/docs-index\`, and \`/api/agent-readiness\`
- Starter guides in the Overview tab and an interactive API reference

Edit this page at \`src/content/changelog.mdx\` to announce your own releases as you ship.
`,
}

const STARTER_SPANISH_PAGES: Record<string, string> = {
  'introduction.mdx': `---
title: Introducción
description: Te damos la bienvenida a {NAME}.
mode: home
---

<Hero
  title="Te damos la bienvenida a {NAME}"
  subtitle="Usa este sitio inicial para presentar tu producto, guiar a tus lectores hasta su primer resultado y publicar una referencia de API clara."
  primaryLabel="Abrir inicio rápido"
  primaryHref="/es/quickstart"
  secondaryLabel="Ver componentes"
  secondaryHref="/es/components"
/>

<CardGroup cols={3}>
  <Card title="Inicio rápido" icon="party-horn" href="/es/quickstart">
    Ayuda a tus lectores a lograr su primer resultado en minutos.
  </Card>
  <Card title="Componentes" icon="grid-round" href="/es/components">
    Usa pestañas, pasos, tarjetas, avisos y acordeones.
  </Card>
  <Card title="Referencia de API" icon="code-simple" href="/es/api">
    Convierte \`openapi.yaml\` en documentación interactiva.
  </Card>
  <Card title="Personalización" icon="wrench" href="/es/customization">
    Adapta la navegación, marca, tipografía y enlaces.
  </Card>
  <Card title="Varios idiomas" icon="message" href="/">
    Cambia entre inglés y español desde el selector de idioma.
  </Card>
  <Card title="Preparado para IA" icon="link-simple" href="/llms.txt">
    Publica contenido legible por agentes desde el primer día.
  </Card>
</CardGroup>
`,
  'quickstart.mdx': `---
title: Inicio rápido
description: Guía a tus lectores hasta su primer resultado con {NAME}.
---

Un buen inicio rápido lleva al lector de cero a un resultado visible sin explicar
todas las opciones.

<Steps>
  <Step title="Instala">
    Explica cómo instalar {NAME} o crear una cuenta.

    \`\`\`bash
    npm install your-package
    \`\`\`
  </Step>
  <Step title="Configura">
    Muestra únicamente la configuración necesaria para comenzar.
  </Step>
  <Step title="Ejecuta">
    Termina con una acción y un resultado que el lector pueda comprobar.
  </Step>
</Steps>

<Tip>Enlaza la siguiente guía que debería leer una vez completado este flujo.</Tip>
`,
  'components.mdx': `---
title: Componentes
description: Una muestra de los componentes MDX disponibles en {NAME}.
---

<Tabs>
  <Tab title="npm">\`npm install your-package\`</Tab>
  <Tab title="pnpm">\`pnpm add your-package\`</Tab>
  <Tab title="yarn">\`yarn add your-package\`</Tab>
</Tabs>

<Accordion title="¿Dónde debe ir la configuración avanzada?">
  Mantén visible el camino principal y coloca los detalles opcionales aquí.
</Accordion>

<Badge variant="success">Estable</Badge>{" "}
<Badge variant="warning">Beta</Badge>{" "}
<Badge variant="info">Nuevo</Badge>
`,
  'customization.mdx': `---
title: Personalización
description: Haz que {NAME} se sienta como una parte natural de tu producto.
---

<CardGroup cols={2}>
  <Card title="Marca y tema" icon="party-horn">Configura colores, logotipos, tipografía y apariencia.</Card>
  <Card title="Navegación" icon="book-open">Organiza pestañas, grupos con iconos y páginas en \`docs.json\`.</Card>
  <Card title="Dominios" icon="link-simple">Conecta un dominio personalizado desde Thally Cloud.</Card>
  <Card title="Analítica y feedback" icon="message">Comprende qué necesitan tus lectores.</Card>
</CardGroup>
`,
  'changelog.mdx': `---
title: Novedades
description: Cambios, versiones y mejoras destacadas de {NAME}.
---

## v0.1.0

La primera versión de la documentación de **{NAME}**.

- Sitio creado con [Thally](https://github.com/thallylabs/thally)
- Referencia de API y contenido preparado para agentes
- Ejemplo bilingüe en inglés y español
`,
}

function buildStarterDocsJson({
  enableAiChat,
  repoUrl,
  i18nLocales,
}: {
  enableAiChat: boolean
  repoUrl?: string
  i18nLocales?: Array<{ code: string; label: string }>
}): string {
  const config: Record<string, unknown> = {}

  // Match the canonical Thally docs presentation. Owners can still change this
  // portable setting later without touching the application runtime.
  config.theme = 'default'

  if (enableAiChat) {
    config.ai = { chat: true }
  }

  if (repoUrl) {
    config.navbar = {
      links: [{ label: 'GitHub', href: repoUrl, type: 'github' }],
      primary: { label: 'Get started', href: '/quickstart' },
    }
  }

  const locales = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
    ...(i18nLocales ?? []).filter(({ code }) => code !== 'en' && code !== 'es'),
  ]
  config.i18n = { defaultLocale: 'en', locales }

  config.tabs = [
    {
      tab: 'Overview',
      groups: [
        { group: 'Getting Started', icon: 'book-open', pages: ['introduction', 'quickstart'] },
        { group: 'Explore', icon: 'grid-round', pages: ['components'] },
        { group: 'Project', icon: 'wrench', pages: ['customization'] },
      ],
    },
    { tab: 'API Reference', api: { source: 'openapi.yaml' } },
    { tab: 'Changelog', href: '/changelog' },
  ]

  return JSON.stringify(config, null, 2) + '\n'
}

export function writeStarterContent(
  targetDir: string,
  projectName: string,
  enableAiChat = true,
  repoUrl = '',
  i18nLocales?: Array<{ code: string; label: string }>,
): void {
  const contentDir = join(targetDir, 'src', 'content')

  // Clear existing example content
  if (existsSync(contentDir)) {
    const entries = readdirSync(contentDir)
    for (const entry of entries) {
      const fullPath = join(contentDir, entry)
      rmSync(fullPath, { recursive: true, force: true })
    }
  } else {
    mkdirSync(contentDir, { recursive: true })
  }

  // Write starter pages
  for (const [filename, template] of Object.entries(STARTER_PAGES)) {
    const content = template.replace(/\{NAME\}/g, projectName)
    writeFileSync(join(contentDir, filename), content, 'utf8')
  }

  const spanishDir = join(contentDir, 'es')
  mkdirSync(spanishDir, { recursive: true })
  for (const [filename, template] of Object.entries(STARTER_SPANISH_PAGES)) {
    const content = template.replace(/\{NAME\}/g, projectName)
    writeFileSync(join(spanishDir, filename), content, 'utf8')
  }

  writeFileSync(
    join(targetDir, 'docs.json'),
    buildStarterDocsJson({ enableAiChat, repoUrl: repoUrl || undefined, i18nLocales }),
    'utf8',
  )
}

export function writeStarterAgentGuide(targetDir: string, projectName: string): void {
  const guide = `# ${projectName} documentation instructions

## About this project

- This is a documentation site built with [Thally](https://github.com/thallylabs/thally).
- Pages are MDX files with YAML frontmatter in \`src/content/\`.
- Navigation and product features are configured in \`docs.json\`.
- Site identity and fallback brand values live in \`src/data/site.ts\`.
- Use \`/llms.txt\`, \`/llms-full.txt\`, and \`/skill.md\` on the deployed site for agent-readable context.

## Terminology

<!-- Add product-specific terms and preferred usage. -->

## Writing style

- Use active voice and address the reader as “you.”
- Keep sentences concise and headings in sentence case.
- Bold interface labels and format commands, files, and code with backticks.
- Lead with the outcome, then explain prerequisites and steps.

## Content boundaries

<!-- Define what belongs in public docs and what must remain internal. -->
`
  writeFileSync(join(targetDir, 'AGENTS.md'), guide, 'utf8')
}

export function writeStarterReadme(targetDir: string, projectName: string): void {
  const readme = `# ${projectName}

Documentation powered by [Thally](https://github.com/thallylabs/thally).

## Local development

\`\`\`bash
npm install
npm run dev
\`\`\`

The server starts at [http://localhost:3040](http://localhost:3040), or the next
available port when 3040 is already in use.

## Write your docs

- Add MDX pages in \`src/content/\`.
- Organize navigation and product features in \`docs.json\`.
- Update the site name, links, and brand defaults in \`src/data/site.ts\`.
- Copy \`.env.example\` to \`.env.local\` for local secrets.

The starter includes a home hero, icon-grouped navigation, English and Spanish
examples, a guided quickstart, component showcase, changelog, OpenAPI reference,
and \`AGENTS.md\` writing instructions for coding agents.

## Publishing changes

Push changes to the default branch to trigger your connected deployment. If the
site is not connected yet, add the repository in
[Thally Cloud](https://app.thally.io) or deploy it to any Next.js host.

Run \`npx create-thally-docs check --ci .\` before publishing. Deploy the site
anywhere Next.js is supported, or connect the repository to
[Thally Cloud](https://app.thally.io) for managed hosting and services.
`
  writeFileSync(join(targetDir, 'README.md'), readme, 'utf8')
}

export function updateSiteConfig(
  targetDir: string,
  projectName: string,
  description: string,
  brandPreset: string,
  repoUrl: string,
): void {
  const siteFile = join(targetDir, 'src', 'data', 'site.ts')
  if (!existsSync(siteFile)) {
    console.log('  ⚠️  Could not find src/data/site.ts — skipping config update.')
    return
  }

  let source = readFileSync(siteFile, 'utf8')

  // Replace name
  source = source.replace(
    /name:\s*'[^']*'/,
    `name: '${projectName.replace(/'/g, "\\'")}'`,
  )

  // Replace description — only match when the quoted value follows immediately (whitespace only)
  // Avoids matching `description: string` in the interface declaration
  source = source.replace(
    /description:\s*\n\s*'[^']*'/,
    `description:\n    '${description.replace(/'/g, "\\'")}'`,
  )

  // Replace brand preset
  source = source.replace(
    /const brandPreset:\s*BrandPresetKey\s*=\s*'[^']*'/,
    `const brandPreset: BrandPresetKey = '${brandPreset}'`,
  )

  // Always reset the repo URL + links (to the user's repo, or blank) so a new
  // site NEVER inherits the Thally template's github.com/thallylabs/thally.
  source = source.replace(/repoUrl:\s*'[^']*'/, `repoUrl: '${repoUrl}'`)
  source = source.replace(
    /\{\s*label:\s*'GitHub',\s*href:\s*'[^']*'\s*\}/,
    `{ label: 'GitHub', href: '${repoUrl}' }`,
  )
  source = source.replace(
    /\{\s*label:\s*'Support',\s*href:\s*'[^']*'\s*\}/,
    `{ label: 'Support', href: '${repoUrl ? `${repoUrl}/issues/new` : ''}' }`,
  )

  // A fresh site may not have a repository URL yet. Omit those links until it
  // does instead of rendering empty anchors with duplicate React keys.
  if (!repoUrl) {
    source = source.replace(
      /\n\s*\{\s*label:\s*'(?:GitHub|Support)',\s*href:\s*''\s*\},?/g,
      '',
    )
  }

  writeFileSync(siteFile, source, 'utf8')
}

export function patchApiReferenceGuard(targetDir: string): void {
  const filePath = join(targetDir, 'src', 'data', 'api-reference.ts')
  if (!existsSync(filePath)) return
  let source = readFileSync(filePath, 'utf8')
  // Guard buildApiNavigation against empty specs (no API tab in docs.json)
  source = source.replace(
    /export async function buildApiNavigation\([^)]*\)[^{]*\{\n/,
    (match) => `${match}  if (apiReferenceConfig.specs.length === 0) return []\n`,
  )
  writeFileSync(filePath, source, 'utf8')
}

export function patchTopBarNavigation(targetDir: string): void {
  const filePath = join(targetDir, 'src', 'components', 'layout', 'top-bar.tsx')
  if (!existsSync(filePath)) return
  const source = readFileSync(filePath, 'utf8')
  // No-op if already fixed or not present
  if (!source.includes("target={isExternal ? '_blank' : undefined}")) return
  const patched = source.replace(
    /if \(collection\.href\) \{\n              const isExternal[^\n]+\n              return \(\n                <a[\s\S]*?<\/a>\n              \)\n            \}/,
    `if (collection.href) {
              const isExternal = /^https?:\\/\\//.test(collection.href)
              if (isExternal) {
                return (
                  <a
                    key={collection.id}
                    href={collection.href}
                    target="_blank"
                    rel="noreferrer"
                    className={baseClasses}
                  >
                    {collection.label}
                  </a>
                )
              }
              return (
                <Link
                  key={collection.id}
                  href={collection.href}
                  className={baseClasses}
                >
                  {collection.label}
                </Link>
              )
            }`,
  )
  writeFileSync(filePath, patched, 'utf8')
}

export function patchOpenApiFetch(targetDir: string): void {
  const filePath = join(targetDir, 'src', 'lib', 'openapi', 'fetch.ts')
  if (!existsSync(filePath)) return
  let source = readFileSync(filePath, 'utf8')
  // Fix URL-style paths (e.g. /openapi.json) to resolve relative to public/ instead of fs root
  source = source.replace(
    /const absolutePath = path\.isAbsolute\(filePath\) \? filePath : path\.resolve\(process\.cwd\(\), filePath\)/,
    `const absolutePath = filePath.startsWith('/')\n    ? path.resolve(process.cwd(), 'public', filePath.slice(1))\n    : path.resolve(process.cwd(), filePath)`,
  )
  writeFileSync(filePath, source, 'utf8')
}

export function updateEnvExample(targetDir: string): void {
  const envFile = join(targetDir, '.env.example')
  if (existsSync(envFile)) {
    const envLocal = join(targetDir, '.env.local')
    if (!existsSync(envLocal)) {
      cpSync(envFile, envLocal)
    }
  }
}

/**
 * Normalize the canonical docs package for a newly named standalone site.
 * `thallylabs/docs` is already standalone, while this defensive cleanup also
 * keeps local or older monorepo-based sources safe to scaffold:
 *
 *   - `workspaces` points at a directory that doesn't exist in scaffolds.
 *   - `prebuild`/`pretest` invoke `packages:build`, which builds those absent
 *     workspaces. `embeddings:build` stays in `prebuild`: it runs standalone
 *     (local-hash provider, no API key needed) and powers hybrid search.
 *   - The copied `package-lock.json` still resolves the monorepo's workspace
 *     graph; deleting it lets the scaffold's own `npm install` write a clean
 *     lockfile. Workspace-linked deps (e.g. @thallylabs/core) resolve from the
 *     npm registry instead, which is why the template must depend on published
 *     versions, never `workspace:*` specs.
 *
 * Also names the package after the site so `npm ls`/lockfiles read correctly.
 */
export function patchPackageJson(targetDir: string, slug: string): void {
  const pkgPath = join(targetDir, 'package.json')
  if (!existsSync(pkgPath)) return
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    name?: string
    workspaces?: unknown
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
  }

  const hadWorkspaces = Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0
  pkg.name = slug
  delete pkg.workspaces
  if (pkg.scripts) {
    if (pkg.scripts['prebuild']) pkg.scripts['prebuild'] = 'npm run embeddings:build'
    delete pkg.scripts['pretest']
    delete pkg.scripts['packages:build']
  }

  // The canonical docs repository previously resolved MCP through a workspace
  // wildcard. Fresh sites have no workspace, so use the published package
  // version explicitly and let npm create a portable standalone lockfile.
  if (pkg.dependencies?.['@thallylabs/mcp'] === '*') {
    pkg.dependencies['@thallylabs/mcp'] = '0.7.0'
  }

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

  const lockPath = join(targetDir, 'package-lock.json')
  if (!existsSync(lockPath)) return
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
    name?: string
    packages?: Record<string, { name?: string }>
  }
  const hasWorkspaceEntries = Object.keys(lock.packages ?? {}).some(
    (key) => key === 'packages' || key.startsWith('packages/'),
  )

  if (hadWorkspaces || hasWorkspaceEntries) {
    rmSync(lockPath)
    return
  }

  // The canonical docs source is already standalone. Preserve its known-good,
  // reproducible dependency graph and update only the project identity.
  lock.name = slug
  if (lock.packages?.['']) lock.packages[''].name = slug
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
}

/** Ensure dependency folders are ignored at any depth in generated sites. */
export function patchGitignore(targetDir: string): void {
  const gitignorePath = join(targetDir, '.gitignore')
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : ''
  const lines = existing.split(/\r?\n/)
  if (lines.includes('node_modules/')) return

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  writeFileSync(gitignorePath, `${existing}${separator}node_modules/\n`, 'utf8')
}
