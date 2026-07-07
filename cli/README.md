# create-dox

Scaffold a new [Dox](https://github.com/kenny-io/Dox) documentation project in seconds.

## Usage

### With npx (recommended)

```bash
npx create-dox my-docs
```

### Or install globally

```bash
npm install -g create-dox
create-dox my-docs
```

### Interactive prompts

If you run without arguments, the CLI will ask you:

```
$ npx create-dox

  ╔══════════════════════════════════════╗
  ║       ██████╗  ██████╗ ██╗  ██╗      ║
  ║       ██╔══██╗██╔═══██╗╚██╗██╔╝      ║
  ║       ██║  ██║██║   ██║ ╚███╔╝       ║
  ║       ██║  ██║██║   ██║ ██╔██╗       ║
  ║       ██████╔╝╚██████╔╝██╔╝ ██╗      ║
  ║       ╚═════╝  ╚═════╝ ╚═╝  ╚═╝      ║
  ║                                      ║
  ║   Beautiful docs, zero lock-in.      ║
  ╚══════════════════════════════════════╝

  Project directory (my-docs): acme-docs
  Project name (Acme Docs):
  Description (Documentation for Acme Docs.):
  Brand preset:
    1) primary
    2) secondary
  > Choose [1]: 1
  GitHub repo URL (optional): https://github.com/acme/docs
  Install dependencies? (Y/n): Y
```

## What it does

1. Clones the Dox template from GitHub
2. Replaces example content with starter pages customized to your project name
3. Updates `src/data/site.ts` with your name, description, branding, and repo URL
4. Writes a minimal `docs.json` navigation config
5. Installs dependencies
6. Initializes a fresh git repo

## After scaffolding

```bash
cd my-docs
npm run dev
```

Open [http://localhost:3040](http://localhost:3040) to see your docs.

### Key files

| File | Purpose |
| --- | --- |
| `src/data/site.ts` | Site name, links, brand colors |
| `docs.json` | Navigation tabs, groups, pages |
| `src/content/*.mdx` | Your documentation pages |
| `openapi.yaml` | API spec (optional) |

## Requirements

- Node.js >= 18
- Git
