 Here is Claude's plan:                                                                     
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Phase 1: Dox CLI Upgrade + MCP Server                                                      
                                                        
 Context

 Dox already has a working CLI at cli/ (zero-dep JS, uses git clone). Phase 1 upgrades it
 to a TypeScript package under packages/create-dox/ (replaces git with tarball download, so
  git is not required), and adds a brand-new packages/mcp/ MCP server so any LLM tool
 (Claude Code, Cursor, etc.) can scaffold and manage Dox projects programmatically.

 The two packages share scaffold logic. The MCP server wraps it as 4 callable tools.

 ---
 Directory Structure

 dox/
 ├── package.json                   # MODIFY: add "workspaces": ["packages/*"]
 ├── cli/                           # KEEP as-is (retire after packages ship)
 └── packages/
     ├── create-dox/
     │   ├── package.json
     │   ├── tsconfig.json
     │   ├── tsup.config.ts
     │   └── src/
     │       ├── index.ts           # bin entry — parse argv, run prompts, call scaffold
     │       ├── scaffold.ts        # orchestration pipeline (exported for MCP reuse)
     │       ├── prompts.ts         # @inquirer/prompts wrappers
     │       ├── download.ts        # fetch GitHub tarball + tar extract (no git needed)
     │       ├── customize.ts       # patch site.ts, write starter content + docs.json
     │       └── utils.ts           # slugify, run, logo, success
     └── mcp/
         ├── package.json
         ├── tsconfig.json
         ├── tsup.config.ts
         └── src/
             ├── index.ts           # bin entry — connect stdio transport
             ├── server.ts          # McpServer + register all tools
             ├── tools/
             │   ├── create-project.ts
             │   ├── add-page.ts
             │   ├── list-pages.ts
             │   └── update-page.ts
             └── lib/
                 ├── docs-json.ts   # read/write/mutate docs.json
                 └── scaffold.ts    # re-export scaffold() from create-dox workspace

 ---
 Step-by-Step Implementation

 Step 1 — Root package.json

 Add "workspaces": ["packages/*"] and a packages:build convenience script. No other
 changes.

 Step 2 — packages/create-dox

 package.json key fields:
 - name: "create-dox", version: "0.2.0"
 - bin: { "create-dox": "./dist/index.js" }
 - deps: @inquirer/prompts ^7, tar ^6
 - devDeps: tsup ^8, typescript ^5, @types/node ^22
 - type: "module", engines: { node: ">=18" }
 - exports: { ".": "./dist/index.js", "./scaffold": "./dist/scaffold.js" }

 tsconfig.json: target: ES2022, module: NodeNext, moduleResolution: NodeNext

 tsup.config.ts: entry: ['src/index.ts', 'src/scaffold.ts'], format: ['esm'], banner: { js:
  '#!/usr/bin/env node' }, platform: node

 src/utils.ts: Port slugify, run, runSilent, initGit, installDeps, logo, success from
 cli/src/index.js exactly.

 src/download.ts: Replace git clone with fetch + tar extract:
 const url = `https://codeload.github.com/kenny-io/Dox/tar.gz/main`
 // fetch → Readable.fromWeb(response.body) → tar.extract({ cwd, strip: 1, filter })
 // filter: exclude /cli/, /packages/, /node_modules/, /.git/
 Use tar v6 API: tar.extract({ cwd, strip: 1, filter }, nodeStream)

 src/customize.ts: Port writeStarterContent, updateSiteConfig, updateEnvExample from CLI
 unchanged. Keep exact regex patterns:
 - name: '[^']*' → name
 - description:[\s\S]*?'([^']*)' → description
 - const brandPreset:.*=.*'[^']*' → preset
 - { label: 'GitHub', href: '[^']*' } → repoUrl

 src/prompts.ts: Replace readline ask/choose with @inquirer/prompts input() and select().
 Export gatherAnswers(dirArg, useDefaults): Promise<ScaffoldAnswers>.

 src/scaffold.ts (exported): Orchestrate in order:
 1. Validate + create target dir
 2. downloadTemplate(targetDir) (logs "Downloading Dox template...")
 3. writeStarterContent(targetDir, name, slug)
 4. updateSiteConfig(targetDir, name, desc, preset, repoUrl)
 5. updateEnvExample(targetDir)
 6. installDeps(targetDir) if doInstall
 7. initGit(targetDir)
 8. Return { projectDir: abs }

 src/index.ts: Parse argv → gatherAnswers() → scaffold() → success(). Wrap in try/catch
 with process.exit(1).

 Step 3 — packages/mcp

 package.json key fields:
 - name: "@dox/mcp", version: "0.1.0"
 - bin: { "dox-mcp": "./dist/index.js" }
 - deps: @modelcontextprotocol/sdk ^1.15, gray-matter ^4, zod ^3
 - Note: scaffold logic is copied (not workspace-linked) so @dox/mcp is self-contained when
  run via npx

 src/lib/docs-json.ts: Types DocsJsonConfig, DocsJsonTab, DocsJsonGroup (mirrored from
 src/data/docs.ts). Functions readDocsJson(projectDir), writeDocsJson(projectDir, config).

 src/lib/scaffold.ts: Copy of packages/create-dox/src/scaffold.ts (no workspace import —
 keeps MCP self-contained for npx usage).

 src/tools/create-project.ts — Tool: create_project
 - Input schema (zod): projectDir (required), projectName?, description?, brandPreset?
 (enum primary|secondary, default primary), repoUrl?, install? (bool, default true)
 - Handler: calls scaffold(), returns success text with next steps

 src/tools/add-page.ts — Tool: add_page
 - Input schema: projectDir (req), pageId (req, e.g. "guides/auth"), title (req),
 description?, content?, tab?, group?, position? (enum start|end, default end)
 - Handler:
   a. Validate pageId (alphanumeric + hyphens + slashes, no .mdx)
   b. Compute MDX path: src/content/{pageId}.mdx
   c. Error if file already exists
   d. mkdirSync(dirname, { recursive: true })
   e. Write MDX with frontmatter + content (or placeholder)
   f. Read docs.json → find/create tab → find/create group → push/unshift pageId → write
 docs.json
 - Return: { mdxPath, pageId, tab, group }

 src/tools/list-pages.ts — Tool: list_pages
 - Input: projectDir (req)
 - Handler: reads docs.json, formats as text tree:
 Tab: Overview
   Group: Getting Started
     - introduction  →  /
     - quickstart    →  /quickstart

 src/tools/update-page.ts — Tool: update_page
 - Input: projectDir (req), pageId (req), title?, description?, content?, mergeFrontmatter?
 - Handler: find file (try .mdx then /index.mdx), parse with gray-matter, merge
 frontmatter, replace body if provided, matter.stringify(body.trim(), newFm), write file

 src/server.ts: Create McpServer({ name: '@dox/mcp', version: '0.1.0' }), register all 4
 tools, export createServer().

 src/index.ts: Node version guard (exit if < 18), createServer(), new
 StdioServerTransport(), server.connect(transport).

 Step 4 — Install & Build

 npm install        # links workspaces
 npm run build -w packages/create-dox
 npm run build -w packages/mcp

 Step 5 — Test CLI

 node packages/create-dox/dist/index.js test-project --yes
 Verify: project created, site.ts patched, docs.json written, deps installed.

 Step 6 — Test MCP server locally

 Run the server and pipe JSON-RPC over stdin:
 echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node
 packages/mcp/dist/index.js
 Should return the 4 tools with their schemas.

 Test add_page tool with a real project dir.

 Step 7 — MCP config snippet (add to Dox docs)

 Users add to their Claude Desktop / Claude Code settings:
 {
   "mcpServers": {
     "dox": {
       "command": "npx",
       "args": ["-y", "@dox/mcp"]
     }
   }
 }

 ---
 Critical Files

 ┌──────────────────┬───────────────────────────────────────────────────────┐
 │       File       │                        Action                         │
 ├──────────────────┼───────────────────────────────────────────────────────┤
 │ package.json     │ Add workspaces, packages:build script                 │
 ├──────────────────┼───────────────────────────────────────────────────────┤
 │ cli/src/index.js │ Reference only — port regex patterns + scaffold steps │
 ├──────────────────┼───────────────────────────────────────────────────────┤
 │ src/data/site.ts │ Reference only — regex targets for patchSiteConfig    │
 ├──────────────────┼───────────────────────────────────────────────────────┤
 │ src/data/docs.ts │ Reference only — mirror types into lib/docs-json.ts   │
 ├──────────────────┼───────────────────────────────────────────────────────┤
 │ docs.json        │ Reference only — understand tab/group/pages shape     │
 └──────────────────┴───────────────────────────────────────────────────────┘

 ---
 Key Gotchas

 1. tar v6 streaming API: Use tar.extract({ cwd, strip: 1, filter }, nodeStream) not v7
 promise API. Pin tar@^6.2.0.
 2. response.body bridging: Readable.fromWeb(response.body as ...) to convert Web Streams →
  Node Readable.
 3. MCP tool handlers must throw, not return error objects. Wrap handlers in try/catch.
 4. add_page duplicate check: Filter pages to strings before .includes(pageId) since pages
 can contain nested group objects.
 5. matter.stringify body: .trim() the body before passing to avoid double blank lines.
 6. Self-contained MCP: Copy scaffold logic into packages/mcp/src/lib/scaffold.ts — don't
 workspace:* depend on create-dox, since npx @dox/mcp won't have the workspace available.
 7. tsup shebang: The banner: { js: '#!/usr/bin/env node' } in tsup config is what makes
 the compiled binary executable via npx.