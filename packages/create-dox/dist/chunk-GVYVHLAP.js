#!/usr/bin/env node
import {
  initGit,
  installDeps,
  scaffold
} from "./chunk-23YWNWTH.js";

// src/migrate/index.ts
import { mkdirSync as mkdirSync2, copyFileSync as copyFileSync2, readFileSync as readFileSync3, writeFileSync, existsSync as existsSync3, mkdtempSync, rmSync } from "fs";
import { join as join3, dirname as dirname2, resolve } from "path";
import { tmpdir } from "os";
import pLimit from "p-limit";

// src/migrate/github.ts
import { execSync } from "child_process";
import { existsSync, readdirSync, statSync, copyFileSync, mkdirSync } from "fs";
import { join, relative, extname, basename, dirname } from "path";
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
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const filename of OPENAPI_FILENAMES) {
    if (entries.includes(filename)) {
      return { absPath: join(dir, filename), filename };
    }
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const fullPath = join(dir, entry);
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
    execSync(cmd, { stdio: "pipe" });
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
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
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
    const fullPath = candidate ? join(cloneDir, candidate) : cloneDir;
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
var I18N_DIR_PREFIXES = /* @__PURE__ */ new Set(["fr", "es", "de", "ja", "ko", "zh", "pt", "it", "ru", "ar", "nl", "pl", "tr", "vi", "th", "id", "hi", "uk", "cs", "sv", "da", "fi", "no", "he", "ro", "hu", "el", "bg", "sk", "sl", "hr", "lt", "lv", "et", "ms", "fil", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "ur", "fa", "sw"]);
var ASSET_DIRS = /* @__PURE__ */ new Set(["images", "img", "assets", "static", "public", "media"]);
function scanDir(dir, baseDir, primaryOnly, results, skipDirs) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith("_") || entry.startsWith(".") || entry === "node_modules") continue;
    if (ASSET_DIRS.has(entry.toLowerCase())) continue;
    if (skipDirs && skipDirs.has(entry.toLowerCase())) continue;
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      scanDir(fullPath, baseDir, primaryOnly, results, skipDirs);
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
function findDocFiles(cloneDir, docsDir, skipI18n = false) {
  const baseDir = docsDir ? join(cloneDir, docsDir) : cloneDir;
  const skipDirs = skipI18n ? I18N_DIR_PREFIXES : void 0;
  const primaryResults = [];
  scanDir(baseDir, baseDir, true, primaryResults, skipDirs);
  if (primaryResults.length > 0) return primaryResults;
  const allResults = [];
  scanDir(baseDir, baseDir, false, allResults, skipDirs);
  return allResults;
}
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp", ".avif"]);
var ASSET_EXTENSIONS = /* @__PURE__ */ new Set([...IMAGE_EXTENSIONS, ".mp4", ".webm", ".mp3", ".pdf"]);
function scanAssets(dir, baseDir, results) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      scanAssets(fullPath, baseDir, results);
    } else {
      const ext = extname(entry).toLowerCase();
      if (!ASSET_EXTENSIONS.has(ext)) continue;
      results.push({ absPath: fullPath, relPath: relative(baseDir, fullPath) });
    }
  }
}
function copyStaticAssets(cloneDir, docsDir, targetPublicDir) {
  const baseDir = docsDir ? join(cloneDir, docsDir) : cloneDir;
  const assetRoots = [];
  for (const name of ASSET_DIRS) {
    const candidate = join(baseDir, name);
    if (existsSync(candidate)) assetRoots.push(candidate);
  }
  if (assetRoots.length === 0) return 0;
  const assets = [];
  for (const root of assetRoots) {
    scanAssets(root, baseDir, assets);
  }
  for (const asset of assets) {
    const dest = join(targetPublicDir, asset.relPath);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(asset.absPath, dest);
  }
  return assets.length;
}

// src/migrate/importer.ts
import { readFileSync } from "fs";
import { basename as basename2, extname as extname2 } from "path";
import matter from "gray-matter";
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
    const raw = readFileSync(file.absPath, "utf8");
    const parsed = matter(raw);
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
  const content = readFileSync(file.absPath, "utf8");
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

// src/migrate/nav-builder.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { join as join2 } from "path";
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
  if (existsSync2(join2(cloneDir, "mint.json"))) return "mintlify";
  if (existsSync2(join2(cloneDir, "docs.json"))) {
    try {
      const parsed = JSON.parse(readFileSync2(join2(cloneDir, "docs.json"), "utf8"));
      if (Array.isArray(parsed.tabs)) return "dox";
      const schema = parsed.$schema;
      if (schema?.includes("mintlify") || "navigation" in parsed) return "mintlify";
    } catch {
    }
  }
  if (existsSync2(join2(cloneDir, "docusaurus.config.js")) || existsSync2(join2(cloneDir, "docusaurus.config.ts")) || existsSync2(join2(cloneDir, "docusaurus.config.mjs"))) return "docusaurus";
  if (existsSync2(join2(cloneDir, "SUMMARY.md"))) return "gitbook";
  if (existsSync2(join2(cloneDir, ".vitepress"))) return "vitepress";
  if (existsSync2(join2(cloneDir, "astro.config.mjs")) || existsSync2(join2(cloneDir, "astro.config.ts"))) return "starlight";
  if (existsSync2(join2(cloneDir, "_meta.json")) || existsSync2(join2(cloneDir, "pages", "_meta.json"))) return "nextra";
  return "unknown";
}
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function normalizePageRef(ref, docsDir) {
  let r = ref;
  if (docsDir && r.startsWith(docsDir + "/")) r = r.slice(docsDir.length + 1);
  r = r.replace(/\.(mdx?|rst|txt)$/, "");
  const parts = r.split("/");
  const last = parts[parts.length - 1].toLowerCase();
  if (last === "index" || last === "readme") {
    return parts.length === 1 ? "introduction" : parts.slice(0, -1).map(slugify).join("/");
  }
  return parts.map(slugify).join("/");
}
function convertMintTabs(tabs, docsDir) {
  if (tabs.length === 0) return null;
  function convertPageRef(page) {
    if (typeof page === "string") return normalizePageRef(page, docsDir);
    if (page !== null && typeof page === "object" && "group" in page && "pages" in page) {
      const p = page;
      const pages = [];
      if (typeof p.root === "string") {
        pages.push(normalizePageRef(p.root, docsDir));
      }
      pages.push(...(p.pages ?? []).map(convertPageRef));
      const group = { group: String(p.group), pages };
      if (typeof p.icon === "string") group.icon = p.icon;
      return group;
    }
    return String(page);
  }
  const resultTabs = tabs.map((item) => {
    const tabName = String(item.tab);
    if (item.href) return { tab: tabName, href: String(item.href) };
    if (tabName.toLowerCase() === "changelog") return { tab: "Changelog", href: "/changelog" };
    const groups = (item.groups ?? []).map((g) => {
      const group = {
        group: String(g.group),
        pages: (g.pages ?? []).map(convertPageRef)
      };
      if (typeof g.icon === "string") group.icon = g.icon;
      return group;
    });
    return { tab: tabName, groups };
  });
  if (!resultTabs.some((t) => t.tab === "Changelog")) {
    resultTabs.push({ tab: "Changelog", href: "/changelog" });
  }
  return { tabs: resultTabs };
}
function parseMintConfig(config, docsDir) {
  const nav = config.navigation;
  if (nav && typeof nav === "object" && !Array.isArray(nav)) {
    const navObj = nav;
    if (Array.isArray(navObj.languages) && navObj.languages.length > 0) {
      const langs = navObj.languages;
      const enLang = langs.find((l) => l.language === "en") ?? langs[0];
      const langTabs = enLang.tabs;
      if (Array.isArray(langTabs) && langTabs.length > 0) return convertMintTabs(langTabs, docsDir);
    }
    const v3Tabs = navObj.tabs;
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
  const candidates = [join2(cloneDir, "SUMMARY.md")];
  if (docsDir) candidates.push(join2(cloneDir, docsDir, "SUMMARY.md"));
  let raw = "";
  for (const p of candidates) {
    if (existsSync2(p)) {
      raw = readFileSync2(p, "utf8");
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
  const baseDir = docsDir ? join2(cloneDir, docsDir) : cloneDir;
  const metaPath = join2(baseDir, "_meta.json");
  if (!existsSync2(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync2(metaPath, "utf8"));
    const pages = [];
    for (const [key, value] of Object.entries(meta)) {
      if (typeof value === "object" && value !== null) {
        const v = value;
        if (v.type === "separator" || v.type === "menu") continue;
      }
      pages.push(key === "index" ? "introduction" : slugify(key));
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
          readFileSync2(join2(cloneDir, "docs.json"), "utf8")
        );
        console.log(`  \u{1F4CB} Detected ${label} \u2014 using docs.json navigation as-is`);
        return parsed;
      } catch {
        return null;
      }
    }
    case "mintlify": {
      for (const file of ["docs.json", "mint.json"]) {
        const p = join2(cloneDir, file);
        if (!existsSync2(p)) continue;
        try {
          const config = JSON.parse(readFileSync2(p, "utf8"));
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

// src/migrate/index.ts
function readDocsJson(projectDir) {
  const docsPath = join3(projectDir, "docs.json");
  const raw = readFileSync3(docsPath, "utf8");
  return JSON.parse(raw);
}
function writeDocsJson(projectDir, config) {
  const docsPath = join3(projectDir, "docs.json");
  writeFileSync(docsPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}
function mergeDocsJson(existing, incoming) {
  const existingTabNames = new Set(existing.tabs.map((t) => t.tab));
  const merged = { tabs: [...existing.tabs.filter((t) => t.tab !== "Changelog")] };
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
  const tabs = [...config.tabs];
  const existingApiIdx = tabs.findIndex((t) => t.tab.toLowerCase().includes("api"));
  if (existingApiIdx >= 0) {
    const existing = tabs[existingApiIdx];
    if (existing.groups && existing.groups.length > 0) {
      tabs[existingApiIdx] = {
        ...existing,
        api: { source: `/${specFilename}` }
      };
    } else {
      tabs[existingApiIdx] = { tab: existing.tab, api: { source: `/${specFilename}` } };
    }
  } else {
    const apiTab = { tab: "API Reference", api: { source: `/${specFilename}` } };
    const changelogIdx = tabs.findIndex((t) => t.tab === "Changelog");
    if (changelogIdx >= 0) {
      tabs.splice(changelogIdx, 0, apiTab);
    } else {
      tabs.push(apiTab);
    }
  }
  return { ...config, tabs };
}
async function migrateDocs(opts) {
  const { sourceUrl, projectDir: rawProjectDir, into, apiKey, projectName } = opts;
  const projectDir = resolve(rawProjectDir);
  const source = parseGitHubUrl(sourceUrl);
  if (opts.branch) source.branch = opts.branch;
  if (!into) {
    console.log(`
  \u{1F3D7}  Scaffolding new project at ${projectDir}...`);
    await scaffold({
      projectDir,
      projectName: projectName ?? "My Docs",
      description: `Documentation migrated from ${source.owner}/${source.repo}`,
      brandPreset: "primary",
      repoUrl: `https://github.com/${source.owner}/${source.repo}`,
      doInstall: false
    });
  } else {
    if (!existsSync3(projectDir)) {
      throw new Error(
        `Project directory "${projectDir}" does not exist. Use without --into to scaffold a new one.`
      );
    }
  }
  const tmpBase = mkdtempSync(join3(tmpdir(), "dox-migrate-"));
  const cloneDir = join3(tmpBase, "repo");
  console.log(`
  \u{1F4E6} Cloning ${source.owner}/${source.repo}...`);
  try {
    await cloneRepo(source, cloneDir);
    const platform = detectPlatform(cloneDir);
    let docsDir;
    if (opts.docsDir) {
      docsDir = opts.docsDir;
    } else if (source.docsDir) {
      docsDir = source.docsDir;
    } else if (platform === "mintlify") {
      docsDir = "";
    } else {
      docsDir = detectDocsDir(cloneDir);
    }
    const hasI18n = platform === "mintlify";
    const docFiles = findDocFiles(cloneDir, docsDir, hasI18n);
    const docsDirLabel = docsDir ? `${docsDir}/` : "repo root";
    console.log(`  \u{1F4C4} Found ${docFiles.length} files in ${docsDirLabel}`);
    if (docFiles.length === 0) {
      console.warn("  \u26A0  No doc files found. Check the URL and try again.");
      return { pagesWritten: 0, projectDir };
    }
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
    const contentDir = join3(projectDir, "src", "content");
    let pagesWritten = 0;
    for (const page of deduped) {
      const filePath = join3(contentDir, `${page.pageId}.mdx`);
      mkdirSync2(dirname2(filePath), { recursive: true });
      const mdx = [
        "---",
        `title: "${page.frontmatter.title.replace(/"/g, '\\"')}"`,
        `description: "${page.frontmatter.description.replace(/"/g, '\\"')}"`,
        page.frontmatter.keywords.length > 0 ? `keywords: [${page.frontmatter.keywords.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(", ")}]` : null,
        "---",
        "",
        page.body
      ].filter((line) => line !== null).join("\n");
      writeFileSync(filePath, mdx, "utf8");
      pagesWritten++;
    }
    const publicDir = join3(projectDir, "public");
    mkdirSync2(publicDir, { recursive: true });
    const assetCount = copyStaticAssets(cloneDir, docsDir, publicDir);
    if (assetCount > 0) {
      console.log(`  \u{1F5BC}  Copied ${assetCount} static assets \u2192 public/`);
    }
    let finalNav = detectedNav ?? buildNavStructure(deduped);
    if (openApiSpec) {
      copyFileSync2(openApiSpec.absPath, join3(publicDir, openApiSpec.filename));
      console.log(`  \u{1F4CB} Copied ${openApiSpec.filename} \u2192 public/${openApiSpec.filename}`);
      finalNav = injectApiTab(finalNav, openApiSpec.filename);
    }
    if (into && existsSync3(join3(projectDir, "docs.json"))) {
      const existing = readDocsJson(projectDir);
      const merged = mergeDocsJson(existing, finalNav);
      writeDocsJson(projectDir, merged);
    } else {
      writeDocsJson(projectDir, finalNav);
    }
    if (!into) {
      installDeps(projectDir);
      initGit(projectDir);
    }
    console.log("");
    console.log("  \u2705 Migration complete!");
    console.log("");
    console.log(`  \u{1F4C2} ${projectDir}`);
    console.log(`  \u{1F4C4} ${pagesWritten} pages written to src/content/`);
    console.log("");
    if (!into) {
      console.log("  Next steps:");
      console.log("");
      console.log(`    cd ${rawProjectDir}`);
      console.log("    npm run dev");
      console.log("");
    }
    return { pagesWritten, projectDir };
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
}

export {
  parseGitHubUrl,
  migrateDocs
};
