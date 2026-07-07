// src/tools/create-project.ts
import { z } from "zod";

// src/lib/scaffold.ts
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync, cpSync } from "fs";
import { resolve, join } from "path";
import { execSync } from "child_process";
import { Readable, pipeline } from "stream";
import { promisify } from "util";
import tar from "tar";
var pipelineAsync = promisify(pipeline);
var TARBALL_URL = "https://codeload.github.com/kenny-io/Dox/tar.gz/main";
var EXCLUDE_PATHS = ["/cli/", "/packages/", "/node_modules/", "/.git/"];
var STARTER_PAGES = {
  "introduction.mdx": `---
title: Introduction
description: Welcome to {NAME} documentation.
---

## Welcome

This is the home page of your **{NAME}** documentation site, powered by [Dox](https://github.com/kenny-io/Dox).

Get started by editing this file at \`src/content/introduction.mdx\`.
`,
  "quickstart.mdx": `---
title: Quickstart
description: Get up and running with {NAME} in under 5 minutes.
---

## Installation

\`\`\`bash
npm install {SLUG}
\`\`\`

## Basic usage

\`\`\`ts
import { create } from '{SLUG}'

const client = create({ apiKey: 'your-api-key' })
\`\`\`

That's it \u2014 you're ready to go!
`
};
function buildStarterDocsJson({
  enableAiChat,
  repoUrl,
  i18nLocales
}) {
  const config = {};
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
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit" });
}
async function downloadTemplate(targetDir) {
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
    tar.extract({
      cwd: targetDir,
      strip: 1,
      filter: (path) => {
        for (const excluded of EXCLUDE_PATHS) {
          if (path.includes(excluded)) return false;
        }
        return true;
      }
    })
  );
}
function writeStarterContent(targetDir, projectName, slug, enableAiChat = true, repoUrl = "", i18nLocales) {
  const contentDir = join(targetDir, "src", "content");
  if (existsSync(contentDir)) {
    const entries = readdirSync(contentDir);
    for (const entry of entries) {
      execSync(`rm -rf "${join(contentDir, entry)}"`);
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
  if (!existsSync(siteFile)) return;
  let source = readFileSync(siteFile, "utf8");
  source = source.replace(/name:\s*'[^']*'/, `name: '${projectName.replace(/'/g, "\\'")}'`);
  source = source.replace(
    /description:\s*\n\s*'[^']*'/,
    `description:
    '${description.replace(/'/g, "\\'")}'`
  );
  source = source.replace(
    /const brandPreset:\s*BrandPresetKey\s*=\s*'[^']*'/,
    `const brandPreset: BrandPresetKey = '${brandPreset}'`
  );
  if (repoUrl) {
    source = source.replace(/repoUrl:\s*'[^']*'/, `repoUrl: '${repoUrl}'`);
    source = source.replace(
      /\{\s*label:\s*'GitHub',\s*href:\s*'[^']*'\s*\}/,
      `{ label: 'GitHub', href: '${repoUrl}' }`
    );
    source = source.replace(
      /\{\s*label:\s*'Support',\s*href:\s*'[^']*'\s*\}/,
      `{ label: 'Support', href: '${repoUrl}/issues/new' }`
    );
  }
  writeFileSync(siteFile, source, "utf8");
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
    if (!existsSync(envLocal)) cpSync(envFile, envLocal);
  }
}
function installDeps(targetDir) {
  run("npm install", targetDir);
}
function initGit(targetDir) {
  try {
    run("git init", targetDir);
    run("git add -A", targetDir);
    run('git commit -m "Initial commit from create-dox"', targetDir);
  } catch {
  }
}
async function scaffold(options) {
  const { projectDir, projectName, description, brandPreset, repoUrl, doInstall, enableAiChat = true, i18nLocales } = options;
  const targetDir = resolve(projectDir);
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    throw new Error(`Directory "${targetDir}" already exists and is not empty.`);
  }
  mkdirSync(targetDir, { recursive: true });
  const slug = slugify(projectName);
  await downloadTemplate(targetDir);
  writeStarterContent(targetDir, projectName, slug, enableAiChat, repoUrl, i18nLocales);
  updateSiteConfig(targetDir, projectName, description, brandPreset, repoUrl);
  patchApiReferenceGuard(targetDir);
  patchTopBarNavigation(targetDir);
  patchOpenApiFetch(targetDir);
  updateEnvExample(targetDir);
  if (doInstall) installDeps(targetDir);
  initGit(targetDir);
  return { projectDir: targetDir };
}

// src/tools/create-project.ts
var createProjectSchema = z.object({
  projectDir: z.string().describe("Path where the new Dox project should be created"),
  projectName: z.string().optional().describe("Display name of the project (defaults to directory name)"),
  description: z.string().optional().describe("Short description of the project"),
  brandPreset: z.enum(["primary", "secondary"]).optional().default("primary").describe("Brand color preset"),
  repoUrl: z.string().optional().describe("GitHub repository URL (optional)"),
  install: z.boolean().optional().default(true).describe("Whether to run npm install after scaffolding"),
  enableAiChat: z.boolean().optional().default(true).describe("Enable AI chat in docs.json (default true)"),
  i18nLocales: z.array(z.object({ code: z.string(), label: z.string() })).optional().describe('Secondary locales to enable (e.g. [{code:"es",label:"Espa\xF1ol"}])')
});
async function handleCreateProject(input) {
  const { projectDir, brandPreset = "primary", install = true } = input;
  const dirBase = projectDir.split("/").filter(Boolean).pop() ?? "my-docs";
  const projectName = input.projectName ?? dirBase.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const description = input.description ?? `Documentation for ${projectName}.`;
  const repoUrl = input.repoUrl ?? "";
  const result = await scaffold({
    projectDir,
    projectName,
    description,
    brandPreset,
    repoUrl,
    doInstall: install,
    enableAiChat: input.enableAiChat ?? true,
    i18nLocales: input.i18nLocales
  });
  const dirName = result.projectDir.split("/").pop() ?? projectDir;
  return [
    `\u2705 Dox project "${projectName}" created at: ${result.projectDir}`,
    "",
    "Next steps:",
    `  cd ${dirName}`,
    "  npm run dev",
    "",
    "Then open http://localhost:3040 to see your docs.",
    "",
    "Key files to edit:",
    "  \u2022 src/data/site.ts   \u2014 name, links, branding",
    "  \u2022 docs.json          \u2014 navigation, AI chat config",
    "  \u2022 src/content/*.mdx  \u2014 your documentation",
    "",
    ...input.enableAiChat !== false ? ["\u{1F916} AI chat is enabled. Set ANTHROPIC_API_KEY in .env.local."] : []
  ].join("\n");
}

// src/tools/add-page.ts
import { z as z2 } from "zod";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, writeFileSync as writeFileSync3 } from "fs";
import { join as join3, dirname } from "path";

// src/lib/docs-json.ts
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "fs";
import { join as join2 } from "path";
function readDocsJson(projectDir) {
  const docsPath = join2(projectDir, "docs.json");
  const raw = readFileSync2(docsPath, "utf8");
  return JSON.parse(raw);
}
function writeDocsJson(projectDir, config) {
  const docsPath = join2(projectDir, "docs.json");
  writeFileSync2(docsPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

// src/tools/add-page.ts
var addPageSchema = z2.object({
  projectDir: z2.string().describe("Path to the Dox project root"),
  pageId: z2.string().describe('Page identifier (e.g. "guides/auth"). No .mdx extension.'),
  title: z2.string().describe("Page title (used in frontmatter)"),
  description: z2.string().optional().describe("Page description (used in frontmatter)"),
  content: z2.string().optional().describe("MDX body content (placeholder used if omitted)"),
  tab: z2.string().optional().describe("Tab name to add the page to (defaults to first tab)"),
  group: z2.string().optional().describe("Group name within the tab (defaults to first group)"),
  position: z2.enum(["start", "end"]).optional().default("end").describe("Whether to insert at start or end of the group")
});
function isString(value) {
  return typeof value === "string";
}
async function handleAddPage(input) {
  const { projectDir, pageId, title, description, content, position = "end" } = input;
  if (!/^[a-zA-Z0-9\-/]+$/.test(pageId)) {
    throw new Error(
      `Invalid pageId "${pageId}". Use only alphanumeric characters, hyphens, and slashes. Do not include .mdx extension.`
    );
  }
  const mdxPath = join3(projectDir, "src", "content", `${pageId}.mdx`);
  if (existsSync2(mdxPath)) {
    throw new Error(`Page already exists at: ${mdxPath}`);
  }
  mkdirSync2(dirname(mdxPath), { recursive: true });
  const frontmatterLines = [`title: ${title}`];
  if (description) {
    frontmatterLines.push(`description: ${description}`);
  }
  const bodyContent = content ?? `## ${title}

Add your content here.`;
  const mdxContent = `---
${frontmatterLines.join("\n")}
---

${bodyContent}
`;
  writeFileSync3(mdxPath, mdxContent, "utf8");
  const config = readDocsJson(projectDir);
  let targetTab = config.tabs[0];
  if (input.tab) {
    const found = config.tabs.find((t) => t.tab === input.tab);
    if (found) {
      targetTab = found;
    } else {
      const newTab = { tab: input.tab, groups: [] };
      config.tabs.push(newTab);
      targetTab = newTab;
    }
  }
  if (!targetTab.groups) {
    targetTab.groups = [];
  }
  const groupName = input.group ?? (targetTab.groups[0]?.group ?? "General");
  let targetGroup = targetTab.groups.find((g) => g.group === groupName);
  if (!targetGroup) {
    const newGroup = { group: groupName, pages: [] };
    targetTab.groups.push(newGroup);
    targetGroup = newGroup;
  }
  const existingStringPages = targetGroup.pages.filter(isString);
  if (existingStringPages.includes(pageId)) {
    throw new Error(`Page "${pageId}" already exists in group "${groupName}".`);
  }
  if (position === "start") {
    targetGroup.pages.unshift(pageId);
  } else {
    targetGroup.pages.push(pageId);
  }
  writeDocsJson(projectDir, config);
  return [
    `\u2705 Page created: ${mdxPath}`,
    `   pageId:  ${pageId}`,
    `   tab:     ${targetTab.tab}`,
    `   group:   ${groupName}`,
    `   position: ${position}`
  ].join("\n");
}

// src/tools/add-tab.ts
import { z as z3 } from "zod";
var addTabSchema = z3.object({
  projectDir: z3.string().describe("Path to the Dox project root"),
  tabName: z3.string().describe('Display name for the new tab (e.g. "Guides", "API Reference")'),
  href: z3.string().optional().describe('If set, the tab is a redirect link instead of a content tab (e.g. "/changelog")'),
  position: z3.enum(["start", "end"]).optional().default("end").describe("Insert the tab at the start or end of the tab bar")
});
async function handleAddTab(input) {
  const { projectDir, tabName, href, position = "end" } = input;
  const config = readDocsJson(projectDir);
  const existing = config.tabs.find((t) => t.tab === tabName);
  if (existing) {
    throw new Error(`Tab "${tabName}" already exists in docs.json.`);
  }
  const newTab = href ? { tab: tabName, href } : { tab: tabName, groups: [] };
  if (position === "start") {
    config.tabs.unshift(newTab);
  } else {
    config.tabs.push(newTab);
  }
  writeDocsJson(projectDir, config);
  const kind = href ? `redirect \u2192 ${href}` : "content tab (empty, ready for pages)";
  return [
    `\u2705 Tab "${tabName}" added to docs.json`,
    `   kind:     ${kind}`,
    `   position: ${position}`,
    ...href ? [] : [``, `Next: add pages with add_page using tab: "${tabName}"`]
  ].join("\n");
}

// src/tools/list-pages.ts
import { z as z4 } from "zod";
var listPagesSchema = z4.object({
  projectDir: z4.string().describe("Path to the Dox project root")
});
function formatGroup(group, indent) {
  const lines = [`${indent}Group: ${group.group}`];
  for (const page of group.pages) {
    if (typeof page === "string") {
      const href = page === "introduction" ? "/" : `/${page}`;
      lines.push(`${indent}  - ${page.padEnd(30)} \u2192 ${href}`);
    } else {
      lines.push(...formatGroup(page, indent + "  "));
    }
  }
  return lines;
}
async function handleListPages(input) {
  const config = readDocsJson(input.projectDir);
  const lines = [];
  for (const tab of config.tabs) {
    lines.push(`Tab: ${tab.tab}`);
    if (tab.href) {
      lines.push(`  \u2192 External: ${tab.href}`);
    } else if (tab.api) {
      lines.push(`  \u2192 API Reference: ${tab.api.source}`);
    } else if (tab.groups && tab.groups.length > 0) {
      for (const group of tab.groups) {
        lines.push(...formatGroup(group, "  "));
      }
    } else {
      lines.push("  (no pages)");
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// src/tools/update-page.ts
import { z as z5 } from "zod";
import { existsSync as existsSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync4 } from "fs";
import { join as join4 } from "path";
import matter from "gray-matter";
var updatePageSchema = z5.object({
  projectDir: z5.string().describe("Path to the Dox project root"),
  pageId: z5.string().describe('Page identifier (e.g. "guides/auth"). No .mdx extension.'),
  title: z5.string().optional().describe("New page title"),
  description: z5.string().optional().describe("New page description"),
  content: z5.string().optional().describe("New MDX body content (replaces existing body)"),
  mergeFrontmatter: z5.record(z5.unknown()).optional().describe("Additional frontmatter fields to merge in")
});
function findPageFile(projectDir, pageId) {
  const candidates = [
    join4(projectDir, "src", "content", `${pageId}.mdx`),
    join4(projectDir, "src", "content", `${pageId}/index.mdx`)
  ];
  for (const candidate of candidates) {
    if (existsSync3(candidate)) return candidate;
  }
  return null;
}
async function handleUpdatePage(input) {
  const { projectDir, pageId } = input;
  const filePath = findPageFile(projectDir, pageId);
  if (!filePath) {
    throw new Error(
      `Page not found for pageId "${pageId}". Tried:
  src/content/${pageId}.mdx
  src/content/${pageId}/index.mdx`
    );
  }
  const raw = readFileSync3(filePath, "utf8");
  const parsed = matter(raw);
  const newFm = { ...parsed.data };
  if (input.title !== void 0) newFm["title"] = input.title;
  if (input.description !== void 0) newFm["description"] = input.description;
  if (input.mergeFrontmatter) {
    Object.assign(newFm, input.mergeFrontmatter);
  }
  const newBody = input.content !== void 0 ? input.content : parsed.content;
  const newContent = matter.stringify(newBody.trim(), newFm);
  writeFileSync4(filePath, newContent, "utf8");
  return [
    `\u2705 Page updated: ${filePath}`,
    `   pageId: ${pageId}`,
    ...input.title ? [`   title:  ${input.title}`] : [],
    ...input.description ? [`   description: ${input.description}`] : [],
    ...input.content !== void 0 ? ["   body: replaced"] : []
  ].join("\n");
}

// src/tools/migrate-docs.ts
import { z as z6 } from "zod";

// src/lib/migrate/index.ts
import { mkdirSync as mkdirSync3, copyFileSync, writeFileSync as writeFileSync5, existsSync as existsSync6, mkdtempSync, rmSync } from "fs";
import { join as join7, dirname as dirname2, resolve as resolve2 } from "path";
import { tmpdir } from "os";
import { execSync as execSync3 } from "child_process";
import pLimit from "p-limit";

// src/lib/migrate/github.ts
import { execSync as execSync2 } from "child_process";
import { readdirSync as readdirSync2, statSync } from "fs";
import { join as join5, relative, extname, basename } from "path";
var OPENAPI_FILENAMES = [
  "openapi.json",
  "openapi.yaml",
  "openapi.yml",
  "swagger.json",
  "swagger.yaml",
  "swagger.yml"
];
function detectOpenApiSpec(cloneDir) {
  return findOpenApiSpec(cloneDir, 0);
}
function findOpenApiSpec(dir, depth) {
  if (depth > 3) return null;
  let entries;
  try {
    entries = readdirSync2(dir);
  } catch {
    return null;
  }
  for (const filename of OPENAPI_FILENAMES) {
    if (entries.includes(filename)) {
      return { absPath: join5(dir, filename), filename };
    }
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const fullPath = join5(dir, entry);
    try {
      if (statSync(fullPath).isDirectory()) {
        const found = findOpenApiSpec(fullPath, depth + 1);
        if (found) return found;
      }
    } catch {
    }
  }
  return null;
}
function parseGitHubUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.hostname !== "github.com") {
    throw new Error(`URL must be a github.com URL, got: ${url.hostname}`);
  }
  const parts = url.pathname.replace(/^\//, "").split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`GitHub URL must include owner and repo: ${rawUrl}`);
  }
  const owner = parts[0];
  const repo = parts[1];
  let branch = "HEAD";
  let docsDir = "";
  if (parts.length >= 4 && parts[2] === "tree") {
    branch = parts[3];
    if (parts.length > 4) {
      docsDir = parts.slice(4).join("/");
    }
  }
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  return { owner, repo, branch, docsDir, cloneUrl };
}
async function cloneRepo(source, targetDir) {
  const parts = ["git", "clone", "--depth", "1"];
  if (source.branch !== "HEAD") {
    parts.push("--branch", source.branch);
  }
  parts.push(source.cloneUrl, targetDir);
  const cmd = parts.join(" ");
  try {
    execSync2(cmd, { stdio: "pipe" });
  } catch (err) {
    const stderr = err.stderr?.toString().trim() ?? "";
    const msg = stderr || (err instanceof Error ? err.message : String(err));
    throw new Error(`Failed to clone ${source.cloneUrl}: ${msg}`);
  }
}
var MD_EXTENSIONS = /* @__PURE__ */ new Set([".md", ".mdx"]);
var ALL_DOC_EXTENSIONS = /* @__PURE__ */ new Set([".md", ".mdx", ".rst", ".txt"]);
function hasMdFiles(dir) {
  let entries;
  try {
    entries = readdirSync2(dir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    const fullPath = join5(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (hasMdFiles(fullPath)) return true;
      } else if (MD_EXTENSIONS.has(extname(entry).toLowerCase())) {
        return true;
      }
    } catch {
    }
  }
  return false;
}
function detectDocsDir(cloneDir) {
  const candidates = [
    "docs",
    "documentation",
    "content",
    "pages",
    "src/content",
    "src/pages",
    "guide",
    "guides",
    ""
  ];
  for (const candidate of candidates) {
    const fullPath = candidate ? join5(cloneDir, candidate) : cloneDir;
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory() && hasMdFiles(fullPath)) {
        return candidate;
      }
    } catch {
    }
  }
  return "";
}
function slugifySegment(seg) {
  return seg.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function derivePageId(relPath) {
  const normalized = relPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const filename = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  const base = basename(filename, extname(filename));
  if (dirs.length === 0 && base.toLowerCase() === "readme") {
    return "introduction";
  }
  if (base.toLowerCase() === "index") {
    if (dirs.length === 0) return "introduction";
    return dirs.map(slugifySegment).join("/");
  }
  return [...dirs, base].map(slugifySegment).join("/");
}
function scanDir(dir, baseDir, primaryOnly, results) {
  let entries;
  try {
    entries = readdirSync2(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith("_") || entry.startsWith(".") || entry === "node_modules") continue;
    const fullPath = join5(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      scanDir(fullPath, baseDir, primaryOnly, results);
    } else {
      const ext = extname(entry).toLowerCase();
      const validExt = primaryOnly ? MD_EXTENSIONS.has(ext) : ALL_DOC_EXTENSIONS.has(ext);
      if (!validExt) continue;
      const relPath = relative(baseDir, fullPath);
      const pageId = derivePageId(relPath);
      results.push({ absPath: fullPath, relPath, pageId, ext });
    }
  }
}
function findDocFiles(cloneDir, docsDir) {
  const baseDir = docsDir ? join5(cloneDir, docsDir) : cloneDir;
  const primaryResults = [];
  scanDir(baseDir, baseDir, true, primaryResults);
  if (primaryResults.length > 0) return primaryResults;
  const allResults = [];
  scanDir(baseDir, baseDir, false, allResults);
  return allResults;
}

// src/lib/migrate/importer.ts
import { readFileSync as readFileSync4 } from "fs";
import { basename as basename2, extname as extname2 } from "path";
import matter2 from "gray-matter";
import Anthropic from "@anthropic-ai/sdk";
function titleFromFilename(relPath) {
  const filename = relPath.replace(/\\/g, "/").split("/").pop() ?? relPath;
  const base = basename2(filename, extname2(filename));
  return base.split(/[-_]/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
function extractFirstParagraph(content) {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("```") || trimmed.startsWith(":::") || trimmed.startsWith("<")) continue;
    if (trimmed.startsWith("import ") || trimmed.startsWith("export ")) continue;
    return trimmed.slice(0, 200);
  }
  return "";
}
function normalizeComponents(body) {
  let result = body;
  const importedComponents = /* @__PURE__ */ new Set();
  result = result.replace(
    /^import\s+(\w+|\{[^}]+\})\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm,
    (_, imported) => {
      const name = imported.trim();
      if (/^[A-Z]\w*$/.test(name)) importedComponents.add(name);
      return "";
    }
  );
  for (const name of importedComponents) {
    result = result.replace(
      new RegExp(`<${name}(?:\\s[^>]*)?\\/>`, "gm"),
      `{/* <${name} /> \u2014 imported snippet component */}`
    );
    result = result.replace(
      new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "g"),
      `{/* <${name}> \u2014 imported snippet component */}`
    );
  }
  result = result.replace(/<!--([\s\S]*?)-->/g, (_, inner) => `{/*${inner}*/}`);
  result = result.replace(/<Tip>([\s\S]*?)<\/Tip>/g, (_, c) => `<Note>${c}</Note>`);
  result = result.replace(/<Check>([\s\S]*?)<\/Check>/g, (_, c) => `<Note>${c}</Note>`);
  result = result.replace(/<Danger>([\s\S]*?)<\/Danger>/g, (_, c) => `<Error>${c}</Error>`);
  result = result.replace(/<Callout(?:\s[^>]*)?>([\s\S]*?)<\/Callout>/g, (_, c) => `<Note>${c}</Note>`);
  result = result.replace(/:::(\w+)(?:\s+[^\n]*)?\n([\s\S]*?):::/g, (_, type, content) => {
    const tag = mapAdmonitionToDoxTag(type.toLowerCase());
    return `<${tag}>
${content.trim()}
</${tag}>`;
  });
  result = result.replace(
    /\{%\s*hint\s+style="(\w+)"\s*%\}([\s\S]*?)\{%\s*endhint\s*%\}/g,
    (_, style, content) => {
      const tag = mapGitBookStyleToDoxTag(style.toLowerCase());
      return `<${tag}>
${content.trim()}
</${tag}>`;
    }
  );
  result = result.replace(/<AccordionGroup[^>]*>\n?([\s\S]*?)\n?<\/AccordionGroup>/g, (_, inner) => inner.trim());
  result = result.replace(/<Expandable(\s[^>]*)?>/g, (_, attrs = "") => {
    const title = attrs.match(/title="([^"]*)"/)?.[1] ?? "Details";
    return `<Accordion title="${title}">`;
  });
  result = result.replace(/<\/Expandable>/g, "</Accordion>");
  result = result.replace(/<Latex>([\s\S]*?)<\/Latex>/g, (_, inner) => `\`${inner.trim()}\``);
  result = result.replace(/<(?:ResponseField|ParamField)([^>]*)>/g, (_, attrs) => {
    const name = attrs.match(/name="([^"]*)"/)?.[1] ?? "";
    const type = attrs.match(/type="([^"]*)"/)?.[1] ?? "";
    const required = /\brequired\b/.test(attrs);
    const def = attrs.match(/default="([^"]*)"/)?.[1];
    const deprecated = /\bdeprecated\b/.test(attrs);
    const meta = [
      type && `\`${type}\``,
      required && "*(required)*",
      deprecated && "*(deprecated)*",
      def !== void 0 && `*(default: \`${def}\`)*`
    ].filter(Boolean).join(" ");
    return `
**\`${name}\`** ${meta}

`;
  });
  result = result.replace(/<\/(?:ResponseField|ParamField)>/g, "\n");
  result = result.replace(/<RequestExample[^>]*>/g, "<CodeGroup>");
  result = result.replace(/<\/RequestExample>/g, "</CodeGroup>");
  result = result.replace(/<ResponseExample[^>]*>/g, "<CodeGroup>");
  result = result.replace(/<\/ResponseExample>/g, "</CodeGroup>");
  result = result.replace(/<Panel[^>]*>([\s\S]*?)<\/Panel>/g, (_, inner) => inner.trim());
  result = result.replace(/<Badge[^>]*>([\s\S]*?)<\/Badge>/g, (_, inner) => `**${inner.trim()}**`);
  result = result.replace(/<Tile(\s[^>]*)?>/g, (_, attrs = "") => `<Card${attrs}>`);
  result = result.replace(/<\/Tile>/g, "</Card>");
  result = result.replace(/<View(\s[^>]*)?>/g, (_, attrs = "") => {
    const title = attrs.match(/title="([^"]*)"/)?.[1] ?? "View";
    return `<Tab title="${title}">`;
  });
  result = result.replace(/<\/View>/g, "</Tab>");
  result = result.replace(/<Update(\s[^>]*)?>/g, (_, attrs = "") => {
    const label = attrs.match(/label="([^"]*)"/)?.[1] ?? "";
    const desc = attrs.match(/description="([^"]*)"/)?.[1] ?? "";
    return `## ${label}${desc ? `

*${desc}*` : ""}

`;
  });
  result = result.replace(/<\/Update>/g, "\n");
  result = result.replace(/<Prompt[^>]*>([\s\S]*?)<\/Prompt>/g, (_, inner) => {
    return `\`\`\`text
${inner.trim()}
\`\`\``;
  });
  result = result.replace(/<Tree[^>]*>/g, "```\n");
  result = result.replace(/<\/Tree>/g, "\n```");
  result = result.replace(/<Tree\.Folder[^>]*name="([^"]*)"[^>]*>/g, (_, name) => `\u{1F4C1} ${name}/
`);
  result = result.replace(/<\/Tree\.Folder>/g, "");
  result = result.replace(new RegExp('<Tree\\.File[^>]*name="([^"]*)"[^>]*/>', "g"), (_, name) => `  ${name}
`);
  result = result.replace(/<Color[^>]*>/g, "| Name | Value |\n|---|---|\n");
  result = result.replace(/<\/Color>/g, "");
  result = result.replace(/<Color\.Row[^>]*title="([^"]*)"[^>]*>/g, (_, title) => `**${title}**
`);
  result = result.replace(/<\/Color\.Row>/g, "");
  result = result.replace(
    /<Color\.Item[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*\/>/g,
    (_, name, value) => `| ${name} | \`${value}\` |
`
  );
  result = result.replace(/<Banner[^>]*>([\s\S]*?)<\/Banner>/g, "");
  result = result.replace(/<Banner[^>]*\/>/g, "");
  return result;
}
function mapAdmonitionToDoxTag(type) {
  if (type === "warning" || type === "caution") return "Warning";
  if (type === "danger") return "Error";
  if (type === "info") return "Info";
  return "Note";
}
function mapGitBookStyleToDoxTag(style) {
  if (style === "warning") return "Warning";
  if (style === "danger") return "Error";
  if (style === "success") return "Note";
  return "Info";
}
var RST_SYSTEM_PROMPT = `You are a documentation converter. Convert the given file content to clean MDX.
Respond with ONLY valid JSON \u2014 no prose, no markdown fences:
{
  "frontmatter": { "title": "string", "description": "string", "keywords": ["..."] },
  "body": "string \u2014 full MDX body"
}
Rules: preserve code blocks with language hints; convert tables to Markdown; convert callout
boxes to <Note> or <Warning>; preserve heading hierarchy; do not include page title as a heading.`;
function parseClaudeResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const stripped = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    return JSON.parse(stripped);
  }
}
async function importFile(file, apiKey) {
  const ext = file.ext.toLowerCase();
  if (ext === ".md" || ext === ".mdx") {
    const raw = readFileSync4(file.absPath, "utf8");
    const parsed = matter2(raw);
    const fmTitle = parsed.data.title ?? "";
    const fmDesc = parsed.data.description ?? "";
    const fmKeywords = parsed.data.keywords;
    const title = fmTitle || titleFromFilename(file.relPath);
    const description = fmDesc || extractFirstParagraph(parsed.content);
    const keywords = Array.isArray(fmKeywords) ? fmKeywords : [];
    const openapi = parsed.data.openapi;
    const body = normalizeComponents(parsed.content);
    if (openapi && !body.trim()) return null;
    return { pageId: file.pageId, frontmatter: { title, description, keywords }, body };
  }
  if (!apiKey) {
    throw new Error(`Skipping non-Markdown file (no API key): ${file.relPath}`);
  }
  const content = readFileSync4(file.absPath, "utf8");
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: RST_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Convert this documentation file to MDX.

File: ${file.relPath}

Content:
${content.slice(0, 8e4)}`
      }
    ]
  });
  const responseText = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  const claudeResult = parseClaudeResponse(responseText);
  return {
    pageId: file.pageId,
    frontmatter: claudeResult.frontmatter,
    body: claudeResult.body
  };
}

// src/lib/migrate/nav-builder.ts
import { existsSync as existsSync5, readFileSync as readFileSync5 } from "fs";
import { join as join6 } from "path";
function titleCase(str) {
  return str.split("-").map((word) => {
    if (word.toLowerCase() === "api") return "API";
    if (word.toLowerCase() === "sdk") return "SDK";
    if (word.toLowerCase() === "cli") return "CLI";
    if (word.toLowerCase() === "ui") return "UI";
    if (word.toLowerCase() === "faq") return "FAQ";
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(" ");
}
function buildNavStructure(pages) {
  const seen = /* @__PURE__ */ new Set();
  const ordered = [];
  for (const p of pages) {
    if (!seen.has(p.pageId)) {
      seen.add(p.pageId);
      ordered.push(p.pageId);
    }
  }
  const depth1Segments = /* @__PURE__ */ new Set();
  for (const id of ordered) {
    const parts = id.split("/");
    if (parts.length > 1) {
      depth1Segments.add(parts[0]);
    }
  }
  const rootOnlyPages = ordered.filter((id) => !id.includes("/"));
  const useSingleTab = depth1Segments.size === 0 || depth1Segments.size === 1 && rootOnlyPages.length === 0;
  let tabs;
  if (useSingleTab) {
    const groups = buildGroups(ordered, null);
    tabs = [{ tab: "Overview", groups }];
  } else {
    tabs = [];
    if (rootOnlyPages.length > 0) {
      const groups = buildGroups(rootOnlyPages, null);
      tabs.push({ tab: "Overview", groups });
    }
    for (const seg of depth1Segments) {
      const tabPages = ordered.filter((id) => id.startsWith(seg + "/") || id === seg);
      const groups = buildGroups(tabPages, seg);
      tabs.push({ tab: titleCase(seg), groups });
    }
  }
  tabs.push({ tab: "Changelog", href: "/changelog" });
  return { tabs };
}
function buildGroups(pageIds, tabSegment) {
  const groupMap = /* @__PURE__ */ new Map();
  for (const id of pageIds) {
    let groupName;
    if (tabSegment === null) {
      groupName = "Overview";
    } else {
      const rel = id.startsWith(tabSegment + "/") ? id.slice(tabSegment.length + 1) : id;
      const relParts = rel.split("/");
      groupName = relParts.length === 1 ? titleCase(tabSegment) : titleCase(relParts[0]);
    }
    if (!groupMap.has(groupName)) groupMap.set(groupName, []);
    groupMap.get(groupName).push(id);
  }
  const groups = [];
  for (const [groupName, groupPages] of groupMap) {
    const sorted = [...groupPages];
    const introIdx = sorted.indexOf("introduction");
    if (introIdx > 0) {
      sorted.splice(introIdx, 1);
      sorted.unshift("introduction");
    }
    groups.push({ group: groupName, pages: sorted });
  }
  return groups;
}
function detectPlatform(cloneDir) {
  if (existsSync5(join6(cloneDir, "mint.json"))) return "mintlify";
  if (existsSync5(join6(cloneDir, "docs.json"))) {
    try {
      const parsed = JSON.parse(readFileSync5(join6(cloneDir, "docs.json"), "utf8"));
      if (Array.isArray(parsed.tabs)) return "dox";
      const schema = parsed.$schema;
      if (schema?.includes("mintlify") || "navigation" in parsed) return "mintlify";
    } catch {
    }
  }
  if (existsSync5(join6(cloneDir, "docusaurus.config.js")) || existsSync5(join6(cloneDir, "docusaurus.config.ts")) || existsSync5(join6(cloneDir, "docusaurus.config.mjs"))) return "docusaurus";
  if (existsSync5(join6(cloneDir, "SUMMARY.md"))) return "gitbook";
  if (existsSync5(join6(cloneDir, ".vitepress"))) return "vitepress";
  if (existsSync5(join6(cloneDir, "astro.config.mjs")) || existsSync5(join6(cloneDir, "astro.config.ts"))) return "starlight";
  if (existsSync5(join6(cloneDir, "_meta.json")) || existsSync5(join6(cloneDir, "pages", "_meta.json"))) return "nextra";
  return "unknown";
}
function slugify2(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function normalizePageRef(ref, docsDir) {
  let r = ref;
  if (docsDir && r.startsWith(docsDir + "/")) r = r.slice(docsDir.length + 1);
  r = r.replace(/\.(mdx?|rst|txt)$/, "");
  const parts = r.split("/");
  const last = parts[parts.length - 1].toLowerCase();
  if (last === "index" || last === "readme") {
    return parts.length === 1 ? "introduction" : parts.slice(0, -1).map(slugify2).join("/");
  }
  return parts.map(slugify2).join("/");
}
function convertMintTabs(tabs, docsDir) {
  if (tabs.length === 0) return null;
  function convertPageRef(page) {
    if (typeof page === "string") return normalizePageRef(page, docsDir);
    if (page !== null && typeof page === "object" && "group" in page && "pages" in page) {
      const p = page;
      return {
        group: String(p.group),
        pages: (p.pages ?? []).map(convertPageRef)
      };
    }
    return String(page);
  }
  const resultTabs = tabs.map((item) => {
    if (item.href) return { tab: String(item.tab), href: String(item.href) };
    const groups = (item.groups ?? []).map((g) => ({
      group: String(g.group),
      pages: (g.pages ?? []).map(convertPageRef)
    }));
    return { tab: String(item.tab), groups };
  });
  if (!resultTabs.some((t) => t.tab === "Changelog")) {
    resultTabs.push({ tab: "Changelog", href: "/changelog" });
  }
  return { tabs: resultTabs };
}
function parseMintConfig(config, docsDir) {
  const nav = config.navigation;
  if (nav && typeof nav === "object" && !Array.isArray(nav)) {
    const v3Tabs = nav.tabs;
    if (Array.isArray(v3Tabs) && v3Tabs.length > 0) return convertMintTabs(v3Tabs, docsDir);
  }
  if (!Array.isArray(nav) || nav.length === 0) return null;
  if ("tab" in nav[0]) return convertMintTabs(nav, docsDir);
  function convertPageRef(page) {
    if (typeof page === "string") return normalizePageRef(page, docsDir);
    if (page !== null && typeof page === "object" && "group" in page && "pages" in page) {
      const p = page;
      return { group: String(p.group), pages: (p.pages ?? []).map(convertPageRef) };
    }
    return String(page);
  }
  const groups = nav.map((item) => ({
    group: String(item.group ?? ""),
    pages: (item.pages ?? []).map(convertPageRef)
  }));
  return { tabs: [{ tab: "Docs", groups }, { tab: "Changelog", href: "/changelog" }] };
}
function parseGitBookSummary(cloneDir, docsDir) {
  const candidates = [join6(cloneDir, "SUMMARY.md")];
  if (docsDir) candidates.push(join6(cloneDir, docsDir, "SUMMARY.md"));
  let raw = "";
  for (const p of candidates) {
    if (existsSync5(p)) {
      raw = readFileSync5(p, "utf8");
      break;
    }
  }
  if (!raw) return null;
  const groups = [];
  let currentGroupName = "Overview";
  let currentPages = [];
  for (const line of raw.split("\n")) {
    const groupMatch = line.match(/^##\s+(.+)/);
    if (groupMatch) {
      if (currentPages.length > 0) groups.push({ group: currentGroupName, pages: currentPages });
      currentGroupName = groupMatch[1].trim();
      currentPages = [];
      continue;
    }
    const pageMatch = line.match(/^\*\s+\[.+?\]\((.+?)\)/);
    if (pageMatch) {
      const ref = pageMatch[1].trim();
      if (ref.startsWith("http")) continue;
      currentPages.push(normalizePageRef(ref, docsDir));
    }
  }
  if (currentPages.length > 0) groups.push({ group: currentGroupName, pages: currentPages });
  if (groups.length === 0) return null;
  return { tabs: [{ tab: "Docs", groups }, { tab: "Changelog", href: "/changelog" }] };
}
function parseNextraMeta(cloneDir, docsDir) {
  const baseDir = docsDir ? join6(cloneDir, docsDir) : cloneDir;
  const metaPath = join6(baseDir, "_meta.json");
  if (!existsSync5(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync5(metaPath, "utf8"));
    const pages = [];
    for (const [key, value] of Object.entries(meta)) {
      if (typeof value === "object" && value !== null) {
        const v = value;
        if (v.type === "separator" || v.type === "menu") continue;
      }
      pages.push(key === "index" ? "introduction" : slugify2(key));
    }
    if (pages.length === 0) return null;
    return {
      tabs: [
        { tab: "Docs", groups: [{ group: "Overview", pages }] },
        { tab: "Changelog", href: "/changelog" }
      ]
    };
  } catch {
    return null;
  }
}
var PLATFORM_LABELS = {
  mintlify: "Mintlify",
  docusaurus: "Docusaurus",
  gitbook: "GitBook",
  nextra: "Nextra",
  vitepress: "VitePress",
  starlight: "Starlight (Astro)",
  dox: "Dox",
  unknown: "unknown"
};
function detectNavFromConfig(cloneDir, docsDir, platform) {
  const detected = platform ?? detectPlatform(cloneDir);
  const label = PLATFORM_LABELS[detected];
  switch (detected) {
    case "dox": {
      try {
        const parsed = JSON.parse(
          readFileSync5(join6(cloneDir, "docs.json"), "utf8")
        );
        console.log(`  \u{1F4CB} Detected ${label} \u2014 using docs.json navigation as-is`);
        return parsed;
      } catch {
        return null;
      }
    }
    case "mintlify": {
      for (const file of ["docs.json", "mint.json"]) {
        const p = join6(cloneDir, file);
        if (!existsSync5(p)) continue;
        try {
          const config = JSON.parse(readFileSync5(p, "utf8"));
          const nav = parseMintConfig(config, docsDir);
          if (nav) {
            console.log(`  \u{1F4CB} Detected ${label} (${file}) \u2014 converting navigation`);
            return nav;
          }
        } catch {
        }
      }
      return null;
    }
    case "gitbook": {
      const nav = parseGitBookSummary(cloneDir, docsDir);
      if (nav) console.log(`  \u{1F4CB} Detected ${label} (SUMMARY.md) \u2014 converting navigation`);
      return nav;
    }
    case "nextra": {
      const nav = parseNextraMeta(cloneDir, docsDir);
      if (nav) console.log(`  \u{1F4CB} Detected ${label} (_meta.json) \u2014 converting navigation`);
      return nav;
    }
    case "docusaurus":
    case "vitepress":
    case "starlight":
      console.log(`  \u{1F4CB} Detected ${label} \u2014 nav config is JavaScript, using directory structure`);
      return null;
    default:
      return null;
  }
}

// src/lib/migrate/index.ts
function mergeDocsJson(existing, incoming) {
  const existingTabNames = new Set(existing.tabs.map((t) => t.tab));
  const merged = { tabs: [...existing.tabs.filter((t) => t.tab !== "Changelog")] };
  if (existing.ai || incoming.ai) {
    merged.ai = { ...incoming.ai, ...existing.ai };
  }
  for (const tab of incoming.tabs) {
    if (tab.tab === "Changelog") continue;
    if (existingTabNames.has(tab.tab)) {
      const existingTab = merged.tabs.find((t) => t.tab === tab.tab);
      if (existingTab.groups && tab.groups) {
        const existingGroupNames = new Set(existingTab.groups.map((g) => g.group));
        for (const group of tab.groups) {
          if (existingGroupNames.has(group.group)) {
            const eg = existingTab.groups.find((g) => g.group === group.group);
            const existingPageSet = new Set(eg.pages.map((p) => typeof p === "string" ? p : p.group));
            for (const page of group.pages) {
              const key = typeof page === "string" ? page : page.group;
              if (!existingPageSet.has(key)) eg.pages.push(page);
            }
          } else {
            existingTab.groups.push(group);
          }
        }
      } else if (tab.groups) {
        existingTab.groups = tab.groups;
      }
    } else {
      merged.tabs.push(tab);
    }
  }
  merged.tabs.push({ tab: "Changelog", href: "/changelog" });
  return merged;
}
function injectApiTab(config, specFilename) {
  const apiTab = { tab: "API Reference", api: { source: `/${specFilename}` } };
  const tabs = config.tabs.filter((t) => {
    if (t.tab.toLowerCase().includes("api")) return false;
    return true;
  });
  const changelogIdx = tabs.findIndex((t) => t.tab === "Changelog");
  if (changelogIdx >= 0) {
    tabs.splice(changelogIdx, 0, apiTab);
  } else {
    tabs.push(apiTab);
  }
  return { ...config, tabs };
}
function installDeps2(targetDir) {
  execSync3("npm install", { cwd: targetDir, stdio: "inherit" });
}
function initGit2(targetDir) {
  try {
    execSync3("git init", { cwd: targetDir, stdio: "inherit" });
    execSync3("git add -A", { cwd: targetDir, stdio: "inherit" });
    execSync3('git commit -m "Initial commit from create-dox"', { cwd: targetDir, stdio: "inherit" });
  } catch {
  }
}
async function migrateDocs(opts) {
  const { sourceUrl, projectDir: rawProjectDir, into, apiKey, projectName } = opts;
  const projectDir = resolve2(rawProjectDir);
  const source = parseGitHubUrl(sourceUrl);
  if (opts.branch) source.branch = opts.branch;
  if (!into) {
    console.log(`  \u{1F3D7}  Scaffolding new project at ${projectDir}...`);
    await scaffold({
      projectDir,
      projectName: projectName ?? "My Docs",
      description: `Documentation migrated from ${source.owner}/${source.repo}`,
      brandPreset: "primary",
      repoUrl: `https://github.com/${source.owner}/${source.repo}`,
      doInstall: false
    });
  } else {
    if (!existsSync6(projectDir)) {
      throw new Error(`Project directory "${projectDir}" does not exist.`);
    }
  }
  const tmpBase = mkdtempSync(join7(tmpdir(), "dox-migrate-"));
  const cloneDir = join7(tmpBase, "repo");
  console.log(`  \u{1F4E6} Cloning ${source.owner}/${source.repo}...`);
  try {
    await cloneRepo(source, cloneDir);
    const docsDir = opts.docsDir ?? (source.docsDir || detectDocsDir(cloneDir));
    const docFiles = findDocFiles(cloneDir, docsDir);
    const docsDirLabel = docsDir ? `${docsDir}/` : "repo root";
    console.log(`  \u{1F4C4} Found ${docFiles.length} files in ${docsDirLabel}`);
    if (docFiles.length === 0) {
      console.warn("  \u26A0  No doc files found. Check the URL and try again.");
      return { pagesWritten: 0, projectDir };
    }
    const platform = detectPlatform(cloneDir);
    const detectedNav = detectNavFromConfig(cloneDir, docsDir, platform);
    const openApiSpec = detectOpenApiSpec(cloneDir);
    if (openApiSpec) {
      console.log(`  \u{1F50C} Found OpenAPI spec: ${openApiSpec.filename}`);
    }
    const limit = pLimit(5);
    let doneCount = 0;
    const imported = (await Promise.all(
      docFiles.map(
        (file) => limit(async () => {
          try {
            const result = await importFile(file, apiKey);
            doneCount++;
            if (result) {
              console.log(`    [${doneCount}/${docFiles.length}] ${result.pageId}`);
            } else {
              console.log(`    [${doneCount}/${docFiles.length}] ${file.pageId} (openapi \u2014 wired via spec)`);
            }
            return result;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("no API key")) {
              console.warn(`    \u26A0  ${msg}`);
            } else {
              console.warn(`    \u26A0  Skipping ${file.relPath}: ${msg}`);
            }
            doneCount++;
            return null;
          }
        })
      )
    )).filter(Boolean);
    const pageIdSeen = /* @__PURE__ */ new Set();
    const deduped = imported.filter((p) => {
      if (pageIdSeen.has(p.pageId)) return false;
      pageIdSeen.add(p.pageId);
      return true;
    });
    const contentDir = join7(projectDir, "src", "content");
    let pagesWritten = 0;
    for (const page of deduped) {
      const filePath = join7(contentDir, `${page.pageId}.mdx`);
      mkdirSync3(dirname2(filePath), { recursive: true });
      const mdx = [
        "---",
        `title: "${page.frontmatter.title.replace(/"/g, '\\"')}"`,
        `description: "${page.frontmatter.description.replace(/"/g, '\\"')}"`,
        page.frontmatter.keywords.length > 0 ? `keywords: [${page.frontmatter.keywords.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(", ")}]` : null,
        "---",
        "",
        page.body
      ].filter((line) => line !== null).join("\n");
      writeFileSync5(filePath, mdx, "utf8");
      pagesWritten++;
    }
    let finalNav = detectedNav ?? buildNavStructure(deduped);
    if (openApiSpec) {
      const publicDir = join7(projectDir, "public");
      mkdirSync3(publicDir, { recursive: true });
      copyFileSync(openApiSpec.absPath, join7(publicDir, openApiSpec.filename));
      console.log(`  \u{1F4CB} Copied ${openApiSpec.filename} \u2192 public/${openApiSpec.filename}`);
      finalNav = injectApiTab(finalNav, openApiSpec.filename);
    }
    if (into && existsSync6(join7(projectDir, "docs.json"))) {
      const existing = readDocsJson(projectDir);
      const merged = mergeDocsJson(existing, finalNav);
      writeDocsJson(projectDir, merged);
    } else {
      writeDocsJson(projectDir, finalNav);
    }
    if (!into) {
      installDeps2(projectDir);
      initGit2(projectDir);
    }
    return { pagesWritten, projectDir };
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
}

// src/tools/migrate-docs.ts
var migrateDocsSchema = z6.object({
  sourceUrl: z6.string().describe("GitHub URL of the docs repo to migrate"),
  projectDir: z6.string().describe("Path for new project or existing project dir"),
  into: z6.boolean().optional().default(false).describe("Migrate into existing project instead of scaffolding"),
  branch: z6.string().optional().describe("Git branch (default: auto-detect)"),
  docsDir: z6.string().optional().describe("Docs subdirectory in repo (default: auto-detect)"),
  apiKey: z6.string().optional().describe("Anthropic API key for non-Markdown file conversion")
});
async function handleMigrateDocs(input) {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const result = await migrateDocs({
    sourceUrl: input.sourceUrl,
    projectDir: input.projectDir,
    into: input.into ?? false,
    apiKey,
    branch: input.branch,
    docsDir: input.docsDir,
    yes: true
  });
  return `Migration complete! ${result.pagesWritten} pages written to ${result.projectDir}/src/content/`;
}

// src/tools/search-docs.ts
import { z as z7 } from "zod";
import { readdirSync as readdirSync3, statSync as statSync2, readFileSync as readFileSync7, existsSync as existsSync7 } from "fs";
import { join as join8, relative as relative2, extname as extname3 } from "path";
import matter3 from "gray-matter";
var searchDocsSchema = z7.object({
  projectDir: z7.string().describe("Path to the Dox project root"),
  query: z7.string().describe("Search query"),
  limit: z7.number().optional().default(5).describe("Max results to return (default 5)")
});
function scanMdxFiles(dir, results) {
  let entries;
  try {
    entries = readdirSync3(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join8(dir, entry);
    try {
      const stat = statSync2(fullPath);
      if (stat.isDirectory()) {
        scanMdxFiles(fullPath, results);
      } else if (extname3(entry).toLowerCase() === ".mdx") {
        results.push(fullPath);
      }
    } catch {
    }
  }
}
function scoreFiles(files, contentDir, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  for (const filePath of files) {
    let raw;
    try {
      raw = readFileSync7(filePath, "utf8");
    } catch {
      continue;
    }
    const { data, content } = matter3(raw);
    const title = data.title ?? "";
    const description = data.description ?? "";
    const keywords = data.keywords ?? [];
    const pageId = relative2(contentDir, filePath).replace(/\.mdx$/, "").replace(/\\/g, "/");
    let score = 0;
    for (const term of terms) {
      if (title.toLowerCase().includes(term)) score += 3;
      if (description.toLowerCase().includes(term)) score += 2;
      if (keywords.some((k) => k.toLowerCase().includes(term))) score += 2;
      const bodyOccurrences = content.toLowerCase().split(term).length - 1;
      score += Math.min(bodyOccurrences, 5);
    }
    if (score > 0) {
      results.push({ pageId, title, description, score });
    }
  }
  return results.sort((a, b) => b.score - a.score);
}
async function handleSearchDocs(input) {
  const { projectDir, query, limit = 5 } = input;
  const contentDir = join8(projectDir, "src", "content");
  if (!existsSync7(contentDir)) {
    throw new Error(`Content directory not found: ${contentDir}`);
  }
  const files = [];
  scanMdxFiles(contentDir, files);
  const results = scoreFiles(files, contentDir, query).slice(0, limit);
  if (results.length === 0) {
    return `No results found for "${query}".`;
  }
  const lines = [`Found ${results.length} result${results.length > 1 ? "s" : ""} for "${query}":
`];
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title || r.pageId} \u2014 ${r.pageId}`);
    if (r.description) lines.push(`   ${r.description}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

// src/tools/semantic-search.ts
import { z as z8 } from "zod";
var semanticSearchSchema = z8.object({
  siteUrl: z8.string().describe("Base URL of the deployed Dox site (e.g. https://docs.example.com)"),
  query: z8.string().describe("Natural-language search query"),
  limit: z8.number().optional().default(8).describe("Max results to return (default 8)"),
  mode: z8.enum(["hybrid", "fulltext"]).optional().default("hybrid").describe("Search mode: hybrid (full-text + vector) or fulltext")
});
async function handleSemanticSearch(input) {
  const { siteUrl, query, limit = 8, mode = "hybrid" } = input;
  const base = siteUrl.replace(/\/$/, "");
  const url = `${base}/api/search?q=${encodeURIComponent(query)}&limit=${limit}&mode=${mode}`;
  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new Error(`Failed to reach ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new Error(`Search request failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.results || data.results.length === 0) {
    return `No results found for "${query}".`;
  }
  const lines = [`Found ${data.total} result${data.total === 1 ? "" : "s"} for "${query}" (${data.mode}):
`];
  data.results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title} \u2014 ${result.url}`);
    if (result.snippet) lines.push(`   ${result.snippet}`);
    lines.push(`   API: ${result.api_url}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

// src/tools/agent-readiness.ts
import { z as z9 } from "zod";
var agentReadinessSchema = z9.object({
  siteUrl: z9.string().describe("Base URL of the deployed Dox site (e.g. https://docs.example.com)"),
  minScore: z9.number().optional().describe("Optional threshold (0-100). If set, the summary flags whether the site passes.")
});
async function handleAgentReadiness(input) {
  const { siteUrl, minScore } = input;
  const base = siteUrl.replace(/\/$/, "");
  const url = `${base}/api/agent-readiness`;
  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new Error(`Failed to reach ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new Error(`Agent readiness request failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const lines = [
    `Agent Readiness: ${data.score}/100 (grade ${data.grade}) across ${data.totalPages} pages.`
  ];
  if (typeof minScore === "number") {
    lines.push(data.score >= minScore ? `PASS (>= ${minScore})` : `FAIL (< ${minScore})`);
  }
  lines.push("", "Subscores:");
  for (const sub of data.subscores) {
    const pct = Math.round(sub.score * 100);
    const status = sub.available ? `${pct}%` : "n/a";
    lines.push(`- ${sub.label} (weight ${sub.weight}): ${status} \u2014 ${sub.detail}`);
    for (const offender of sub.offenders.slice(0, 3)) {
      lines.push(`    \u2022 ${offender.href}: ${offender.reason}`);
    }
  }
  return lines.join("\n").trimEnd();
}

// src/tools/read-page.ts
import { z as z10 } from "zod";
import { existsSync as existsSync8, readFileSync as readFileSync8 } from "fs";
import { join as join9 } from "path";
import matter4 from "gray-matter";
var readPageSchema = z10.object({
  projectDir: z10.string().describe("Path to the Dox project root"),
  pageId: z10.string().describe('Page ID, e.g. "guides/authentication"')
});
async function handleReadPage(input) {
  const { projectDir, pageId } = input;
  const contentDir = join9(projectDir, "src", "content");
  const candidates = [
    join9(contentDir, `${pageId}.mdx`),
    join9(contentDir, `${pageId}/index.mdx`)
  ];
  let filePath = null;
  for (const c of candidates) {
    if (existsSync8(c)) {
      filePath = c;
      break;
    }
  }
  if (!filePath) {
    throw new Error(`Page not found: "${pageId}". No file at src/content/${pageId}.mdx`);
  }
  const raw = readFileSync8(filePath, "utf8");
  const { data, content } = matter4(raw);
  const title = data.title ?? pageId;
  const description = data.description ?? "";
  const lines = [`# ${title}`, `*${pageId}*`, ""];
  if (description) {
    lines.push(`> ${description}`);
    lines.push("");
  }
  lines.push("---", "", content.trim());
  return lines.join("\n");
}

// src/tools/get-context.ts
import { z as z11 } from "zod";
import { existsSync as existsSync9, readFileSync as readFileSync9 } from "fs";
import { join as join10 } from "path";
import matter5 from "gray-matter";
var getContextSchema = z11.object({
  projectDir: z11.string().describe("Path to the Dox project root"),
  topic: z11.string().describe("Topic or question to find relevant docs for"),
  maxTokens: z11.number().optional().default(4e3).describe("Approximate token budget for returned context (default 4000)")
});
async function handleGetContext(input) {
  const { projectDir, topic, maxTokens = 4e3 } = input;
  const contentDir = join10(projectDir, "src", "content");
  if (!existsSync9(contentDir)) {
    throw new Error(`Content directory not found: ${contentDir}`);
  }
  const files = [];
  scanMdxFiles(contentDir, files);
  const scored = scoreFiles(files, contentDir, topic).slice(0, 10);
  if (scored.length === 0) {
    return `No relevant documentation found for "${topic}".`;
  }
  const charBudget = Math.floor(maxTokens * 4 * 0.8);
  let usedChars = 0;
  const sections = [];
  for (const result of scored) {
    const candidates = [
      join10(contentDir, `${result.pageId}.mdx`),
      join10(contentDir, `${result.pageId}/index.mdx`)
    ];
    let content = "";
    for (const c of candidates) {
      if (existsSync9(c)) {
        const raw = readFileSync9(c, "utf8");
        const { content: body } = matter5(raw);
        content = body.trim();
        break;
      }
    }
    if (!content) continue;
    const section = [
      `## ${result.title || result.pageId} (${result.pageId})`,
      result.description ? `> ${result.description}` : "",
      "",
      content
    ].filter((l) => l !== null).join("\n");
    if (usedChars + section.length > charBudget) break;
    sections.push(section);
    usedChars += section.length;
  }
  if (sections.length === 0) {
    return `No relevant documentation found for "${topic}".`;
  }
  return sections.join("\n\n---\n\n");
}

// src/tools/lint-project.ts
import { z as z12 } from "zod";
import { existsSync as existsSync10, readFileSync as readFileSync10 } from "fs";
import { join as join11 } from "path";
import matter6 from "gray-matter";
var lintProjectSchema = z12.object({
  projectDir: z12.string().describe("Path to the Dox project root"),
  fix: z12.boolean().optional().default(false).describe("Auto-fix issues where possible (adds orphan pages to nav)")
});
function collectNavPageIds(groups, seen, duplicates) {
  for (const page of groups) {
    if (typeof page === "string") {
      if (seen.has(page)) {
        duplicates.add(page);
      } else {
        seen.add(page);
      }
    } else if (page.pages) {
      collectNavPageIds(page.pages, seen, duplicates);
    }
  }
}
function addOrphanToNav(projectDir, pageId) {
  const config = readDocsJson(projectDir);
  const tab = config.tabs.find((t) => !t.href && !t.api && t.groups && t.groups.length > 0);
  if (!tab || !tab.groups) return;
  const lastGroup = tab.groups[tab.groups.length - 1];
  const existing = lastGroup.pages.filter((p) => typeof p === "string");
  if (!existing.includes(pageId)) {
    lastGroup.pages.push(pageId);
    writeDocsJson(projectDir, config);
  }
}
async function handleLintProject(input) {
  const { projectDir, fix = false } = input;
  const contentDir = join11(projectDir, "src", "content");
  const issues = [];
  if (!existsSync10(join11(projectDir, "docs.json"))) {
    throw new Error(`Not a Dox project: docs.json not found in ${projectDir}`);
  }
  const config = readDocsJson(projectDir);
  const navPageIds = /* @__PURE__ */ new Set();
  const duplicates = /* @__PURE__ */ new Set();
  for (const tab of config.tabs) {
    if (tab.href || tab.api) continue;
    if (!tab.groups || tab.groups.length === 0) {
      issues.push({ severity: "error", message: `Tab "${tab.tab}" has no groups and no href \u2014 it will render empty` });
      continue;
    }
    collectNavPageIds(tab.groups.map((g) => g), navPageIds, duplicates);
  }
  for (const dup of duplicates) {
    issues.push({ severity: "error", message: `[duplicate] "${dup}" appears more than once in docs.json` });
  }
  for (const pageId of navPageIds) {
    const candidates = [
      join11(contentDir, `${pageId}.mdx`),
      join11(contentDir, `${pageId}/index.mdx`)
    ];
    if (!candidates.some((c) => existsSync10(c))) {
      issues.push({
        severity: "error",
        message: `"${pageId}" is in docs.json but has no MDX file`,
        file: `src/content/${pageId}.mdx`
      });
    }
  }
  const allFiles = [];
  if (existsSync10(contentDir)) {
    scanMdxFiles(contentDir, allFiles);
  }
  const fixedOrphans = [];
  for (const filePath of allFiles) {
    const rel = filePath.slice(contentDir.length + 1).replace(/\.mdx$/, "").replace(/\\/g, "/");
    const pageId = rel.endsWith("/index") ? rel.slice(0, -6) : rel;
    if (!navPageIds.has(pageId)) {
      if (fix) {
        addOrphanToNav(projectDir, pageId);
        fixedOrphans.push(pageId);
      } else {
        issues.push({ severity: "warning", message: `"${pageId}" is not in docs.json nav (orphan)`, file: filePath.slice(projectDir.length + 1) });
      }
    }
    let data = {};
    let content = "";
    try {
      const raw = readFileSync10(filePath, "utf8");
      const parsed = matter6(raw);
      data = parsed.data;
      content = parsed.content;
    } catch {
      issues.push({ severity: "error", message: `Could not parse frontmatter`, file: filePath.slice(projectDir.length + 1) });
      continue;
    }
    if (!data.title) {
      issues.push({ severity: "warning", message: `Missing "title" in frontmatter`, file: filePath.slice(projectDir.length + 1) });
    }
    if (!data.description) {
      issues.push({ severity: "warning", message: `Missing "description" in frontmatter`, file: filePath.slice(projectDir.length + 1) });
    }
    if (content.trim().length < 50) {
      issues.push({ severity: "warning", message: `Very short body (${content.trim().length} chars) \u2014 page may be empty`, file: filePath.slice(projectDir.length + 1) });
    }
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const lines = [`Linting ${projectDir}...
`];
  if (errors.length === 0 && warnings.length === 0 && fixedOrphans.length === 0) {
    lines.push("\u2705 No issues found.");
    return lines.join("\n");
  }
  lines.push(`\u274C ${errors.length} error${errors.length !== 1 ? "s" : ""}, \u26A0\uFE0F  ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}
`);
  if (errors.length > 0) {
    lines.push("ERRORS:");
    for (const issue of errors) {
      lines.push(`  ${issue.message}`);
      if (issue.file) lines.push(`  \u2192 ${issue.file}`);
      lines.push("");
    }
  }
  if (warnings.length > 0) {
    lines.push("WARNINGS:");
    for (const issue of warnings) {
      lines.push(`  ${issue.message}`);
      if (issue.file) lines.push(`  \u2192 ${issue.file}`);
      lines.push("");
    }
  }
  if (fixedOrphans.length > 0) {
    lines.push(`\u2705 Auto-fixed ${fixedOrphans.length} orphan page${fixedOrphans.length > 1 ? "s" : ""} (added to nav):`);
    for (const p of fixedOrphans) lines.push(`  + ${p}`);
    lines.push("");
  }
  if (!fix && warnings.some((w) => w.message.includes("orphan"))) {
    lines.push("Tip: run with fix: true to auto-add orphan pages to navigation.");
  }
  return lines.join("\n").trimEnd();
}

// src/tools/translate-docs.ts
import { z as z13 } from "zod";
import { readFileSync as readFileSync11, writeFileSync as writeFileSync7, existsSync as existsSync11, mkdirSync as mkdirSync4 } from "fs";
import { join as join12, dirname as dirname3 } from "path";
import matter7 from "gray-matter";
import Anthropic2 from "@anthropic-ai/sdk";
import pLimit2 from "p-limit";
var translateDocsSchema = z13.object({
  projectDir: z13.string().describe("Path to the Dox project directory"),
  locale: z13.string().describe('Target locale code, e.g. "es", "fr"'),
  pages: z13.array(z13.string()).optional().describe("Page IDs to translate (omit for all pages)"),
  force: z13.boolean().optional().default(false).describe("Overwrite existing translation files"),
  apiKey: z13.string().optional().describe("Anthropic API key (falls back to ANTHROPIC_API_KEY env var)"),
  model: z13.string().optional().default("claude-sonnet-4-6").describe("Claude model to use for translation")
});
function readDocsJson2(projectDir) {
  const docsPath = join12(projectDir, "docs.json");
  const raw = readFileSync11(docsPath, "utf8");
  return JSON.parse(raw);
}
function collectPageIds(pages) {
  const ids = [];
  for (const page of pages) {
    if (typeof page === "string") {
      ids.push(page);
    } else if (page && typeof page === "object" && "pages" in page) {
      ids.push(...collectPageIds(page.pages));
    }
  }
  return ids;
}
function getAllPageIds(config) {
  const ids = [];
  const seen = /* @__PURE__ */ new Set();
  const hrefOnlyPages = [];
  for (const tab of config.tabs) {
    if (tab.api && !tab.groups) continue;
    if (!tab.groups && tab.href) {
      const pageId = tab.href.replace(/^\//, "");
      if (pageId && !seen.has(pageId)) {
        seen.add(pageId);
        ids.push(pageId);
        hrefOnlyPages.push({ tab: tab.tab, pageId });
      }
      continue;
    }
    if (!tab.groups) continue;
    for (const group of tab.groups) {
      for (const id of collectPageIds(group.pages)) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
  }
  return { ids, hrefOnlyPages };
}
function findSourceFile(projectDir, pageId) {
  const contentRoot = join12(projectDir, "src", "content");
  const candidates = [
    join12(contentRoot, `${pageId}.mdx`),
    join12(contentRoot, `${pageId}/index.mdx`)
  ];
  return candidates.find((p) => existsSync11(p)) ?? null;
}
var TRANSLATION_SYSTEM_PROMPT = `You are a professional documentation translator. You will receive an MDX documentation file and translate it into the target language.

CRITICAL RULES \u2014 follow exactly:
1. Translate ALL prose text, headings, and paragraphs.
2. Translate frontmatter fields: title, description, and keywords values.
3. DO NOT translate or modify MDX component names (e.g. <Note>, <Warning>, <Steps>, <Step>, <CodeGroup>, <Tabs>, <Tab>, <Card>, <Accordion>, <Columns>).
4. DO NOT translate component prop names or prop values that are identifiers.
5. DO NOT translate content inside code blocks (\`\`\` ... \`\`\`).
6. DO NOT translate inline code spans (\`...\`).
7. DO NOT translate URLs, file paths, or import statements.
8. Preserve ALL whitespace, blank lines, and indentation exactly as in the original.
9. Preserve ALL frontmatter YAML structure exactly \u2014 only translate the string values.
10. Output ONLY the translated MDX file content \u2014 no preamble, no explanation, no markdown fences.`;
async function translatePage(sourceContent, targetLocaleLabel, targetLocaleCode, model, client) {
  const message = await client.messages.create({
    model,
    max_tokens: 8192,
    system: TRANSLATION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Translate the following MDX documentation file to ${targetLocaleLabel} (locale code: ${targetLocaleCode}). Output ONLY the translated MDX content.

${sourceContent}`
      }
    ]
  });
  const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  return text.trim();
}
async function handleTranslateDocs(input) {
  const { projectDir, locale, pages, force = false, model = "claude-sonnet-4-6" } = input;
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Anthropic API key required. Set ANTHROPIC_API_KEY or pass apiKey.");
  }
  const config = readDocsJson2(projectDir);
  if (!config.i18n) {
    throw new Error('No i18n config found in docs.json. Add an "i18n" block first.');
  }
  const targetLocale = config.i18n.locales.find((l) => l.code === locale);
  if (!targetLocale) {
    const available = config.i18n.locales.map((l) => l.code).join(", ");
    throw new Error(`Locale "${locale}" not found in docs.json. Available: ${available}`);
  }
  if (locale === config.i18n.defaultLocale) {
    throw new Error(`Cannot translate to the default locale "${locale}".`);
  }
  const { ids: allPageIds, hrefOnlyPages } = getAllPageIds(config);
  const targetPageIds = pages ?? allPageIds;
  const contentRoot = join12(projectDir, "src", "content");
  const toTranslate = [];
  const skipped = [];
  for (const pageId of targetPageIds) {
    const sourceFile = findSourceFile(projectDir, pageId);
    if (!sourceFile) {
      skipped.push(`${pageId} (source not found)`);
      continue;
    }
    const relativeFromContent = sourceFile.slice(contentRoot.length + 1);
    const targetFile = join12(contentRoot, locale, relativeFromContent);
    if (existsSync11(targetFile) && !force) {
      skipped.push(`${pageId} (already translated)`);
      continue;
    }
    toTranslate.push({ pageId, sourceFile, targetFile });
  }
  if (toTranslate.length === 0) {
    return `Nothing to translate. ${skipped.length} page(s) skipped.`;
  }
  const client = new Anthropic2({ apiKey });
  const limit = pLimit2(3);
  const results = [];
  await Promise.all(
    toTranslate.map(
      ({ pageId, sourceFile, targetFile }) => limit(async () => {
        try {
          const sourceContent = readFileSync11(sourceFile, "utf8");
          const parsed = matter7(sourceContent);
          if (!parsed.data.title) {
            console.warn(`[translate] ${pageId}: missing title in frontmatter`);
          }
          const translated = await translatePage(sourceContent, targetLocale.label, locale, model, client);
          mkdirSync4(dirname3(targetFile), { recursive: true });
          writeFileSync7(targetFile, translated + "\n", "utf8");
          results.push({ pageId, success: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ pageId, success: false, error: msg });
        }
      })
    )
  );
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const lines = [
    `\u2705 Translation to ${targetLocale.label} (${locale}) complete!`,
    "",
    `  ${succeeded.length}/${toTranslate.length} pages translated successfully`
  ];
  if (hrefOnlyPages.length > 0 && !pages) {
    const labels = hrefOnlyPages.map(({ tab, pageId }) => `${tab} (${pageId}.mdx)`).join(", ");
    lines.push("", `\u2139  Standalone tab page(s) included: ${labels}`);
  }
  if (succeeded.length > 0) {
    lines.push("", "Translated pages:");
    for (const r of succeeded) {
      lines.push(`  \u2713 ${r.pageId}`);
    }
  }
  if (failed.length > 0) {
    lines.push("", "Failed:");
    for (const r of failed) {
      lines.push(`  \u2717 ${r.pageId}: ${r.error}`);
    }
  }
  if (skipped.length > 0) {
    lines.push("", `${skipped.length} page(s) skipped`);
  }
  lines.push("", `Files written to: ${contentRoot}/${locale}/`);
  return lines.join("\n");
}

// src/lib/tools.ts
function defineTool(def) {
  return def;
}
var tools = [
  defineTool({
    name: "create_project",
    description: "Scaffold a new Dox documentation project from the GitHub template",
    scope: "project",
    schema: createProjectSchema,
    handler: handleCreateProject
  }),
  defineTool({
    name: "add_page",
    description: "Add a new MDX page to a Dox project and register it in docs.json navigation",
    scope: "project",
    schema: addPageSchema,
    handler: handleAddPage
  }),
  defineTool({
    name: "add_tab",
    description: "Add a new top-level tab to a Dox project navigation (content tab or redirect link)",
    scope: "project",
    schema: addTabSchema,
    handler: handleAddTab
  }),
  defineTool({
    name: "list_pages",
    description: "List all pages in a Dox project, organized by tab and group",
    scope: "project",
    schema: listPagesSchema,
    handler: handleListPages
  }),
  defineTool({
    name: "update_page",
    description: "Update the frontmatter or body content of an existing MDX page in a Dox project",
    scope: "project",
    schema: updatePageSchema,
    handler: handleUpdatePage
  }),
  defineTool({
    name: "migrate_docs",
    description: "Crawl a docs site and migrate it into a Dox project",
    scope: "project",
    schema: migrateDocsSchema,
    handler: handleMigrateDocs
  }),
  defineTool({
    name: "search_docs",
    description: "Search documentation pages by keyword \u2014 returns ranked list of matching pages",
    scope: "project",
    schema: searchDocsSchema,
    handler: handleSearchDocs
  }),
  defineTool({
    name: "semantic_search",
    description: "Hybrid (full-text + vector) semantic search against a deployed Dox site \u2014 uses the same index as the in-app command palette and /api/search",
    scope: "site",
    schema: semanticSearchSchema,
    handler: handleSemanticSearch
  }),
  defineTool({
    name: "agent_readiness",
    description: "Fetch the Agent Readiness Score (0-100) for a deployed Dox site \u2014 the same report as /api/agent-readiness and `dox check`, with per-signal subscores and fixable offenders",
    scope: "site",
    schema: agentReadinessSchema,
    handler: handleAgentReadiness
  }),
  defineTool({
    name: "read_page",
    description: "Read the full content of a documentation page by its page ID",
    scope: "project",
    schema: readPageSchema,
    handler: handleReadPage
  }),
  defineTool({
    name: "get_context",
    description: "Get the most relevant documentation context for a topic or question, within a token budget",
    scope: "project",
    schema: getContextSchema,
    handler: handleGetContext
  }),
  defineTool({
    name: "lint_project",
    description: "Check a Dox project for issues: broken nav references, orphan files, missing frontmatter",
    scope: "project",
    schema: lintProjectSchema,
    handler: handleLintProject
  }),
  defineTool({
    name: "translate_docs",
    description: "Translate Dox documentation pages to a secondary locale using Claude AI",
    scope: "project",
    schema: translateDocsSchema,
    handler: handleTranslateDocs
  })
];
function getTool(name) {
  return tools.find((tool) => tool.name === name);
}
export {
  getTool,
  tools
};
