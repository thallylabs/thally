import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Lowest `@thallylabs/cli` release a scaffold may declare.
 *
 * The managed builder depends on the Cloudflare-aware CLI contract, so a site
 * scaffolded from an older or locally-vendored template must not keep a
 * pre-Workers pin. This is a FLOOR, never an override: the canonical template
 * tracks the newest published CLI, and overwriting its pin with a constant that
 * has since aged past it silently downgrades every generated site. Raise it
 * only alongside a released CLI — `scaffold-hygiene.test.ts` fails if it ever
 * climbs above the version this monorepo publishes.
 */
export const MIN_CLI_VERSION = '0.6.0'

/**
 * Lowest `@thallylabs/mcp` release a scaffold may declare. Same floor semantics
 * as {@link MIN_CLI_VERSION}; it also stands in for the unresolvable `*` range
 * that older workspace-based templates used.
 */
export const MIN_MCP_VERSION = '0.8.0'

/**
 * Compare two bare `x.y.z` versions, or return `null` if either is not one.
 *
 * Ranges (`^0.1.0`), dist-tags (`latest`) and prereleases encode intent the
 * scaffold has no business second-guessing, so an unparseable side means
 * "leave the template's value alone" rather than "assume it is older".
 */
function compareExactVersions(a: string, b: string): number | null {
  const parse = (value: string): number[] | null =>
    /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return null
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return 0
}

/**
 * Resolve a dependency pin to at least `floor`, preferring what the template
 * already ships. An absent, unresolvable, or demonstrably older pin becomes the
 * floor; anything newer — or anything the comparison cannot rank — survives.
 */
export function raisePinToFloor(current: string | undefined, floor: string): string {
  if (!current || current === '*') return floor
  const ordering = compareExactVersions(current, floor)
  if (ordering === null) return current
  return ordering < 0 ? floor : current
}

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
  title="Start building with {NAME}"
  subtitle="Complete the quickstart, learn the core workflow, then choose the next task that matches your goal."
  primaryLabel="Start the quickstart"
  primaryHref="/quickstart"
  secondaryLabel="Explore components"
  secondaryHref="/components"
/>

## Build your documentation

Start with the first useful result, then shape the content around your readers.

<CardGroup cols="2">
  <Card title="Complete the quickstart" icon="party-horn" href="/quickstart">
    Install {NAME}, complete the smallest useful workflow, and verify the result.
  </Card>
  <Card title="Create a guide" icon="grid-round" href="/components">
    Turn a product task into clear steps using tabs, cards, callouts, and more.
  </Card>
  <Card title="Integrate the API" icon="code-simple" href="/api">
    Find an endpoint, understand its inputs, and make your first request.
  </Card>
  <Card title="Customize your site" icon="wrench" href="/customization">
    Make the navigation, brand, typography, and links your own.
  </Card>
</CardGroup>

## Publish and extend

Add another language or make the same documentation available to an AI agent.

<CardGroup cols="2">
  <Card title="Publish another language" icon="message" href="/es">
    Use the included Spanish pages as a starting point for localized documentation.
  </Card>
  <Card title="Connect an AI agent" icon="link-simple" href="/llms.txt">
    Give an agent clean, structured context through the generated discovery endpoints.
  </Card>
</CardGroup>

<Note type="info" title="Make it yours">
  Start by editing \`src/content/introduction.mdx\`. Then update \`docs.json\` to
  organize navigation and \`src/data/site.ts\` to set your product name and links.
</Note>
`,
  'quickstart.mdx': `---
title: Get started with {NAME}
description: Install {NAME}, complete the core workflow, and verify your first successful result.
keywords:
  - {NAME}
  - quickstart
  - installation
  - getting started
---

By the end of this guide, you will install {NAME}, complete its smallest useful
workflow, and verify the result. Keep this path focused on one outcome; move
optional configuration and alternative workflows into separate guides.

## Before you begin

Replace this starter list with the exact requirements a reader needs:

- An account or credential, if the workflow requires one
- A supported runtime, device, browser, or operating system
- Permission to create or modify the resource used in the example

<Steps>
  <Step title="Install {NAME}">
    Give readers one recommended installation path.

    \`\`\`bash
    npm install your-package
    \`\`\`
  </Step>
  <Step title="Add the required configuration">
    Include only the settings required for this first successful run.

    \`\`\`bash
    your-cli init
    \`\`\`
  </Step>
  <Step title="Complete your first task">
    Use one realistic example that produces an observable result.

    \`\`\`bash
    your-cli start
    \`\`\`
  </Step>
  <Step title="Verify the result">
    Tell readers exactly what they should see, where they should see it, and
    how to recover if the expected result does not appear.
  </Step>
</Steps>

## What you accomplished

Summarize the working state the reader now has in one or two sentences.

## Choose your next task

<CardGroup cols={3}>
  <Card title="Create a guide" icon="grid-round" href="/components">
    Learn which content components make a task easier to follow.
  </Card>
  <Card title="Integrate the API" icon="code-simple" href="/api">
    Explore endpoints and make a request against your API.
  </Card>
  <Card title="Customize your site" icon="wrench" href="/customization">
    Update navigation, branding, typography, and project links.
  </Card>
</CardGroup>
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

<CardGroup cols="2">
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
- Starter guides in the Get started tab and an interactive API reference

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
  title="Empieza a crear con {NAME}"
  subtitle="Completa el inicio rápido, aprende el flujo principal y elige la siguiente tarea según tu objetivo."
  primaryLabel="Empezar el inicio rápido"
  primaryHref="/es/quickstart"
  secondaryLabel="Explorar componentes"
  secondaryHref="/es/components"
/>

## Crea tu documentación

Empieza con el primer resultado útil y organiza el contenido para tus lectores.

<CardGroup cols="2">
  <Card title="Completa el inicio rápido" icon="party-horn" href="/es/quickstart">
    Instala {NAME}, completa el flujo principal y comprueba el resultado.
  </Card>
  <Card title="Crea una guía" icon="grid-round" href="/es/components">
    Convierte una tarea en pasos claros con pestañas, tarjetas y avisos.
  </Card>
  <Card title="Integra la API" icon="code-simple" href="/es/api">
    Encuentra un endpoint, comprende sus entradas y realiza una solicitud.
  </Card>
  <Card title="Personaliza el sitio" icon="wrench" href="/es/customization">
    Adapta la navegación, marca, tipografía y enlaces.
  </Card>
</CardGroup>

## Publica y amplía

Añade otro idioma o comparte la misma documentación con un agente de IA.

<CardGroup cols="2">
  <Card title="Publica otro idioma" icon="message" href="/">
    Cambia entre inglés y español desde el selector de idioma.
  </Card>
  <Card title="Conecta un agente de IA" icon="link-simple" href="/llms.txt">
    Ofrece contexto estructurado mediante los endpoints de descubrimiento.
  </Card>
</CardGroup>
`,
  'quickstart.mdx': `---
title: Empieza con {NAME}
description: Instala {NAME}, completa el flujo principal y comprueba tu primer resultado.
---

Al terminar esta guía, habrás instalado {NAME}, completado su flujo más útil y
comprobado el resultado.

## Antes de empezar

- Una cuenta o credencial, si el flujo la necesita
- Un entorno, dispositivo o navegador compatible
- Permiso para crear o modificar el recurso del ejemplo

<Steps>
  <Step title="Instala {NAME}">
    Muestra una única ruta de instalación recomendada.

    \`\`\`bash
    npm install your-package
    \`\`\`
  </Step>
  <Step title="Añade la configuración necesaria">
    Incluye solo los ajustes necesarios para completar este flujo.
  </Step>
  <Step title="Completa tu primera tarea">
    Usa un ejemplo realista que produzca un resultado observable.
  </Step>
  <Step title="Comprueba el resultado">
    Explica qué debe ver el lector y dónde debe encontrarlo.
  </Step>
</Steps>

## Elige tu siguiente tarea

<CardGroup cols={3}>
  <Card title="Crea una guía" icon="grid-round" href="/es/components" />
  <Card title="Integra la API" icon="code-simple" href="/es/api" />
  <Card title="Personaliza el sitio" icon="wrench" href="/es/customization" />
</CardGroup>
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

<CardGroup cols="2">
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
      tab: 'Get started',
      groups: [
        { group: 'Start here', icon: 'book-open', pages: ['introduction', 'quickstart'] },
        { group: 'Create content', icon: 'grid-round', pages: ['components'] },
        { group: 'Customize your site', icon: 'wrench', pages: ['customization'] },
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

/**
 * Write provider-portable Cloudflare Workers configuration into every scaffold.
 *
 * The files contain no account, route, bucket, or token identifiers. Thally
 * Cloud supplies those operational values while self-hosters can deploy the
 * same source tree to their own account without editing application internals.
 */
export function writeCloudflareRuntimeConfig(targetDir: string, slug: string): void {
  writeFileSync(
    join(targetDir, 'open-next.config.ts'),
    `/** OpenNext adapter configuration for the Cloudflare Workers runtime. */
import { defineCloudflareConfig } from '@opennextjs/cloudflare/config'

export default defineCloudflareConfig()
`,
    'utf8',
  )

  writeFileSync(
    join(targetDir, 'wrangler.jsonc'),
    `${JSON.stringify(
      {
        $schema: 'node_modules/wrangler/config-schema.json',
        name: slug,
        main: '.open-next/worker.js',
        compatibility_date: '2026-07-15',
        compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
        observability: {
          enabled: true,
          logs: { head_sampling_rate: 1 },
          traces: { enabled: true, head_sampling_rate: 0.01 },
        },
        assets: {
          directory: '.open-next/assets',
          binding: 'ASSETS',
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
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
 *     workspaces. Runtime sources and embeddings stay in `prebuild`: both run
 *     standalone and supply request-time data in filesystem-free Workers.
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
    devDependencies?: Record<string, string>
  }

  const hadWorkspaces = Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0
  const hasRuntimeSourceCompiler = existsSync(
    join(targetDir, 'scripts', 'build-runtime-sources.mts'),
  )
  pkg.name = slug
  delete pkg.workspaces
  if (pkg.scripts) {
    if (hasRuntimeSourceCompiler) {
      pkg.scripts['runtime-sources:build'] ??= 'tsx scripts/build-runtime-sources.mts'
      pkg.scripts['predev'] = 'npm run runtime-sources:build'
      pkg.scripts['postinstall'] = 'npm run runtime-sources:build'
      pkg.scripts['prebuild'] =
        'npm run runtime-sources:build && npm run embeddings:build'
    } else {
      pkg.scripts['prebuild'] = 'npm run embeddings:build'
    }
    delete pkg.scripts['pretest']
    delete pkg.scripts['packages:build']
    pkg.scripts['build:cloudflare'] = 'opennextjs-cloudflare build'
    pkg.scripts['preview:cloudflare'] =
      'npm run build:cloudflare && opennextjs-cloudflare preview'
    pkg.scripts['deploy:cloudflare'] =
      'npm run build:cloudflare && opennextjs-cloudflare deploy'
    pkg.scripts['upload:cloudflare'] =
      'npm run build:cloudflare && opennextjs-cloudflare upload'
  }

  pkg.devDependencies ??= {}
  // `thally check` is part of the managed-build contract and is also the
  // documented local/CI validation command. Declare the published CLI in the
  // standalone site rather than relying on the source monorepo's workspace
  // binary being hoisted into node_modules/.bin.
  // Raise older canonical-template pins so a newly scaffolded site cannot
  // retain a pre-Workers release — but never below what the template ships, or
  // the constant ages past the template and starts performing a downgrade.
  const cliPin = raisePinToFloor(pkg.devDependencies['@thallylabs/cli'], MIN_CLI_VERSION)
  const raisedCliPin = cliPin !== pkg.devDependencies['@thallylabs/cli']
  pkg.devDependencies['@thallylabs/cli'] = cliPin
  pkg.devDependencies['@opennextjs/cloudflare'] ??= '1.15.0'
  // vite-tsconfig-paths declares Vite as a peer; the monorepo used to satisfy
  // it incidentally through workspace tooling. Standalone test runs need the
  // peer declared explicitly.
  pkg.devDependencies.vite ??= '7.2.6'
  pkg.devDependencies.wrangler ??= '4.111.0'

  // The canonical docs repository previously resolved MCP through a workspace
  // wildcard. Fresh sites have no workspace, so a `*` — and any pin older than
  // the floor — becomes an explicit published version, letting npm write a
  // portable standalone lockfile.
  let raisedMcpPin = false
  if (pkg.dependencies?.['@thallylabs/mcp']) {
    const mcpPin = raisePinToFloor(pkg.dependencies['@thallylabs/mcp'], MIN_MCP_VERSION)
    raisedMcpPin = mcpPin !== pkg.dependencies['@thallylabs/mcp']
    pkg.dependencies['@thallylabs/mcp'] = mcpPin
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

  // A raised pin no longer describes the tree the template's lockfile resolved.
  // Keeping it would leave the site's own `npm ci` failing on a package.json /
  // lockfile mismatch, so let the scaffold's `npm install` write a fresh one.
  if (hadWorkspaces || hasWorkspaceEntries || raisedCliPin || raisedMcpPin) {
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
