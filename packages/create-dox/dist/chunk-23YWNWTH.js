#!/usr/bin/env node

// src/scaffold.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readdirSync as readdirSync2 } from "fs";
import { resolve } from "path";

// src/download.ts
import { Readable, pipeline } from "stream";
import { promisify } from "util";
import tar from "tar";
var pipelineAsync = promisify(pipeline);
var TARBALL_URL = "https://codeload.github.com/kenny-io/Dox/tar.gz/main";
var EXCLUDE_PATHS = ["/cli/", "/packages/", "/node_modules/", "/.git/"];
function shouldInclude(path) {
  for (const excluded of EXCLUDE_PATHS) {
    if (path.includes(excluded)) {
      return false;
    }
  }
  return true;
}
async function downloadTemplate(targetDir, siteName) {
  console.log("");
  console.log(`  \u23F3 Creating ${siteName?.trim() || "your docs site"}...`);
  const response = await fetch(TARBALL_URL);
  if (!response.ok) {
    throw new Error(`Failed to download template: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("Response body is empty");
  }
  const nodeStream = Readable.fromWeb(response.body);
  await pipelineAsync(
    nodeStream,
    tar.extract({ cwd: targetDir, strip: 1, filter: shouldInclude })
  );
}

// src/customize.ts
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
var STARTER_PAGES = {
  "introduction.mdx": `---
title: Introduction
description: Welcome to {NAME} \u2014 learn what it does, how the docs are organized, and where to start.
keywords:
  - {NAME}
  - documentation
  - overview
  - getting started
---

## Welcome

Welcome to the **{NAME}** documentation. This is your home base for guides, API
references, and everything you need to build with {NAME}. The site is powered by
[Dox](https://github.com/kenny-io/Dox), an agent-native docs platform \u2014 every page
is served to humans as polished HTML and to AI agents as structured JSON, JSON-LD,
and Markdown from the same URL, so assistants can read your docs accurately.

## What you'll find here

- **Guides** \u2014 step-by-step walkthroughs of common tasks and workflows.
- **API reference** \u2014 generated from your OpenAPI spec, with a live "Try It" console.
- **Quickstart** \u2014 install {NAME} and make your first call in a few minutes.

## Next steps

Start with the [Quickstart](/quickstart) to get {NAME} running, then make this site
your own by editing \`src/content/introduction.mdx\` and updating the navigation in
\`docs.json\`. Every change you save is instantly reflected for both readers and agents.
`,
  "quickstart.mdx": `---
title: Quickstart
description: Install {NAME}, configure your API key, and make your first call in under five minutes.
keywords:
  - {NAME}
  - quickstart
  - installation
  - getting started
---

## Installation

Install {NAME} with your package manager of choice. We recommend pinning the
version in your project so builds stay reproducible across machines and CI:

\`\`\`bash
npm install {SLUG}
\`\`\`

## Basic usage

Import the client and initialize it with your API key. Keep the key in an
environment variable rather than committing it to source control, so it never
leaks into your repository or build logs:

\`\`\`ts
import { create } from '{SLUG}'

const client = create({ apiKey: process.env.API_KEY })
\`\`\`

## What's next

That's the basics \u2014 you're ready to build. Explore the guides for common workflows,
open the API reference to try endpoints against a live "Try It" console, or edit this
page at \`src/content/quickstart.mdx\` to document your own onboarding flow.
`,
  "changelog.mdx": `---
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

- Initial docs site scaffolded with [Dox](https://github.com/kenny-io/Dox)
- Agent-ready endpoints live: \`/llms.txt\`, \`/ai.txt\`, \`/api/docs-index\`, and \`/api/agent-readiness\`
- Starter guides in the Overview tab and an interactive API reference

Edit this page at \`src/content/changelog.mdx\` to announce your own releases as you ship.
`
};
function buildStarterDocsJson({
  enableAiChat,
  repoUrl,
  i18nLocales
}) {
  const config = {};
  config.theme = "sharp";
  config.fonts = {
    body: { family: "Plus Jakarta Sans", weight: ["400", "500", "600", "700"] },
    heading: { family: "Outfit", weight: ["600", "700"] }
  };
  if (enableAiChat) {
    config.ai = { chat: true };
  }
  if (repoUrl) {
    config.navbar = {
      links: [{ label: "GitHub", href: repoUrl, type: "github" }],
      primary: { label: "Get started", href: "/quickstart" }
    };
  }
  if (i18nLocales && i18nLocales.length > 0) {
    config.i18n = {
      defaultLocale: "en",
      locales: [{ code: "en", label: "English" }, ...i18nLocales]
    };
  }
  config.tabs = [
    {
      tab: "Overview",
      groups: [{ group: "Getting Started", pages: ["introduction", "quickstart"] }]
    },
    { tab: "API Reference", api: { source: "openapi.yaml" } },
    { tab: "Changelog", href: "/changelog" }
  ];
  return JSON.stringify(config, null, 2) + "\n";
}
function writeStarterContent(targetDir, projectName, slug, enableAiChat = true, repoUrl = "", i18nLocales) {
  const contentDir = join(targetDir, "src", "content");
  if (existsSync(contentDir)) {
    const entries = readdirSync(contentDir);
    for (const entry of entries) {
      const fullPath = join(contentDir, entry);
      execSync(`rm -rf "${fullPath}"`);
    }
  } else {
    mkdirSync(contentDir, { recursive: true });
  }
  for (const [filename, template] of Object.entries(STARTER_PAGES)) {
    const content = template.replace(/\{NAME\}/g, projectName).replace(/\{SLUG\}/g, slug);
    writeFileSync(join(contentDir, filename), content, "utf8");
  }
  writeFileSync(
    join(targetDir, "docs.json"),
    buildStarterDocsJson({ enableAiChat, repoUrl: repoUrl || void 0, i18nLocales }),
    "utf8"
  );
}
function updateSiteConfig(targetDir, projectName, description, brandPreset, repoUrl) {
  const siteFile = join(targetDir, "src", "data", "site.ts");
  if (!existsSync(siteFile)) {
    console.log("  \u26A0\uFE0F  Could not find src/data/site.ts \u2014 skipping config update.");
    return;
  }
  let source = readFileSync(siteFile, "utf8");
  source = source.replace(
    /name:\s*'[^']*'/,
    `name: '${projectName.replace(/'/g, "\\'")}'`
  );
  source = source.replace(
    /description:\s*\n\s*'[^']*'/,
    `description:
    '${description.replace(/'/g, "\\'")}'`
  );
  source = source.replace(
    /const brandPreset:\s*BrandPresetKey\s*=\s*'[^']*'/,
    `const brandPreset: BrandPresetKey = '${brandPreset}'`
  );
  source = source.replace(/repoUrl:\s*'[^']*'/, `repoUrl: '${repoUrl}'`);
  source = source.replace(
    /\{\s*label:\s*'GitHub',\s*href:\s*'[^']*'\s*\}/,
    `{ label: 'GitHub', href: '${repoUrl}' }`
  );
  source = source.replace(
    /\{\s*label:\s*'Support',\s*href:\s*'[^']*'\s*\}/,
    `{ label: 'Support', href: '${repoUrl ? `${repoUrl}/issues/new` : ""}' }`
  );
  writeFileSync(siteFile, source, "utf8");
}
function patchApiReferenceGuard(targetDir) {
  const filePath = join(targetDir, "src", "data", "api-reference.ts");
  if (!existsSync(filePath)) return;
  let source = readFileSync(filePath, "utf8");
  source = source.replace(
    /export async function buildApiNavigation\([^)]*\)[^{]*\{\n/,
    (match) => `${match}  if (apiReferenceConfig.specs.length === 0) return []
`
  );
  writeFileSync(filePath, source, "utf8");
}
function patchTopBarNavigation(targetDir) {
  const filePath = join(targetDir, "src", "components", "layout", "top-bar.tsx");
  if (!existsSync(filePath)) return;
  const source = readFileSync(filePath, "utf8");
  if (!source.includes("target={isExternal ? '_blank' : undefined}")) return;
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
            }`
  );
  writeFileSync(filePath, patched, "utf8");
}
function patchOpenApiFetch(targetDir) {
  const filePath = join(targetDir, "src", "lib", "openapi", "fetch.ts");
  if (!existsSync(filePath)) return;
  let source = readFileSync(filePath, "utf8");
  source = source.replace(
    /const absolutePath = path\.isAbsolute\(filePath\) \? filePath : path\.resolve\(process\.cwd\(\), filePath\)/,
    `const absolutePath = filePath.startsWith('/')
    ? path.resolve(process.cwd(), 'public', filePath.slice(1))
    : path.resolve(process.cwd(), filePath)`
  );
  writeFileSync(filePath, source, "utf8");
}
function updateEnvExample(targetDir) {
  const envFile = join(targetDir, ".env.example");
  if (existsSync(envFile)) {
    const envLocal = join(targetDir, ".env.local");
    if (!existsSync(envLocal)) {
      cpSync(envFile, envLocal);
    }
  }
}

// src/utils.ts
import { execSync as execSync2 } from "child_process";
import { basename } from "path";
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function run(cmd, cwd) {
  execSync2(cmd, { cwd, stdio: "inherit" });
}
function initGit(targetDir) {
  try {
    run("git init", targetDir);
    run("git add -A", targetDir);
    run('git commit -m "Initial commit from create-dox"', targetDir);
  } catch {
    console.log("  \u26A0\uFE0F  Could not initialize git (you can do this manually).");
  }
}
function installDeps(targetDir) {
  console.log("");
  console.log("  \u{1F4E6} Installing dependencies...");
  console.log("");
  run("npm install", targetDir);
}
function logo() {
  console.log("");
  console.log("  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
  console.log("  \u2551                                      \u2551");
  console.log("  \u2551       \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557  \u2588\u2588\u2557      \u2551");
  console.log("  \u2551       \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u255A\u2588\u2588\u2557\u2588\u2588\u2554\u255D      \u2551");
  console.log("  \u2551       \u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2554\u255D       \u2551");
  console.log("  \u2551       \u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551 \u2588\u2588\u2554\u2588\u2588\u2557       \u2551");
  console.log("  \u2551       \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2554\u255D \u2588\u2588\u2557      \u2551");
  console.log("  \u2551       \u255A\u2550\u2550\u2550\u2550\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D  \u255A\u2550\u255D      \u2551");
  console.log("  \u2551                                      \u2551");
  console.log("  \u2551   Beautiful docs, zero lock-in.      \u2551");
  console.log("  \u2551                                      \u2551");
  console.log("  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
  console.log("");
}
function success(projectDir, projectName) {
  console.log("");
  console.log("  \u2705 Your Dox project is ready!");
  console.log("");
  console.log(`  \u{1F4C2} ${projectDir}`);
  console.log("");
  console.log("  Next steps:");
  console.log("");
  console.log(`    cd ${basename(projectDir)}`);
  console.log("    npm run dev");
  console.log("");
  console.log(`  Then open http://localhost:3040 to see your ${projectName} docs.`);
  console.log("");
  console.log("  \u{1F4DD} Key files to edit:");
  console.log("    \u2022 src/data/site.ts        \u2014 name, links, branding");
  console.log("    \u2022 docs.json               \u2014 navigation structure");
  console.log("    \u2022 src/content/*.mdx        \u2014 your documentation");
  console.log("    \u2022 openapi.yaml            \u2014 API spec (optional)");
  console.log("");
  console.log("  Happy documenting! \u{1F680}");
  console.log("");
}

// src/scaffold.ts
async function scaffold(options) {
  const {
    projectDir,
    projectName,
    description,
    brandPreset,
    repoUrl,
    doInstall,
    enableAiChat = true,
    i18nLocales
  } = options;
  const targetDir = resolve(projectDir);
  if (existsSync2(targetDir) && readdirSync2(targetDir).length > 0) {
    throw new Error(`Directory "${targetDir}" already exists and is not empty.`);
  }
  mkdirSync2(targetDir, { recursive: true });
  const slug = slugify(projectName);
  await downloadTemplate(targetDir, projectName);
  writeStarterContent(targetDir, projectName, slug, enableAiChat, repoUrl, i18nLocales);
  updateSiteConfig(targetDir, projectName, description, brandPreset, repoUrl);
  patchApiReferenceGuard(targetDir);
  patchTopBarNavigation(targetDir);
  patchOpenApiFetch(targetDir);
  updateEnvExample(targetDir);
  if (doInstall) {
    installDeps(targetDir);
  }
  initGit(targetDir);
  return { projectDir: targetDir };
}

export {
  slugify,
  initGit,
  installDeps,
  logo,
  success,
  scaffold
};
