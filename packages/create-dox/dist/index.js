#!/usr/bin/env node
import {
  migrateDocs,
  parseGitHubUrl
} from "./chunk-GVYVHLAP.js";
import {
  logo,
  scaffold,
  slugify,
  success
} from "./chunk-23YWNWTH.js";

// src/index.ts
import { existsSync as existsSync3, readdirSync as readdirSync2 } from "fs";
import { resolve as resolve2 } from "path";

// src/prompts.ts
import { input, select } from "@inquirer/prompts";
import { basename } from "path";
import { resolve } from "path";
async function gatherAnswers(dirArg, useDefaults) {
  let projectDir;
  if (dirArg) {
    projectDir = resolve(dirArg);
  } else if (useDefaults) {
    projectDir = resolve("my-docs");
  } else {
    const dirName = await input({
      message: "  Project directory:",
      default: "my-docs"
    });
    projectDir = resolve(dirName);
  }
  const defaultName = basename(projectDir).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const projectName = useDefaults ? defaultName : await input({
    message: "  Project name:",
    default: defaultName
  });
  const defaultDesc = `Documentation for ${projectName}.`;
  const description = useDefaults ? defaultDesc : await input({
    message: "  Description:",
    default: defaultDesc
  });
  const brandPreset = useDefaults ? "primary" : await select({
    message: "  Brand preset:",
    choices: [
      { name: "primary", value: "primary" },
      { name: "secondary", value: "secondary" }
    ],
    default: "primary"
  });
  const repoUrl = useDefaults ? "" : await input({
    message: "  GitHub repo URL (optional):",
    default: ""
  });
  let doInstall = true;
  if (!useDefaults) {
    const shouldInstall = await input({
      message: "  Install dependencies? (Y/n):",
      default: "Y"
    });
    doInstall = shouldInstall.toLowerCase() !== "n";
  }
  let i18nLocales;
  if (!useDefaults) {
    const enableI18n = await input({
      message: "  Enable multi-language support? (y/N):",
      default: "N"
    });
    if (enableI18n.toLowerCase() === "y") {
      const localesInput = await input({
        message: "  Which locales? (comma-separated codes, e.g. es,fr,de):",
        default: "es"
      });
      const LOCALE_LABELS = {
        en: "English",
        es: "Espa\xF1ol",
        fr: "Fran\xE7ais",
        de: "Deutsch",
        it: "Italiano",
        pt: "Portugu\xEAs",
        ja: "\u65E5\u672C\u8A9E",
        ko: "\uD55C\uAD6D\uC5B4",
        zh: "\u4E2D\u6587",
        ru: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",
        ar: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629",
        nl: "Nederlands"
      };
      const codes = localesInput.split(",").map((c) => c.trim()).filter(Boolean);
      i18nLocales = codes.map((code) => ({
        code,
        label: LOCALE_LABELS[code] ?? code.toUpperCase()
      }));
    }
  }
  return { projectDir, projectName, description, brandPreset, repoUrl, doInstall, i18nLocales };
}

// src/check.ts
import { existsSync, readFileSync as readFileSync2, readdirSync, statSync } from "fs";
import { join as join2, extname, relative } from "path";
import { execFileSync } from "child_process";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";

// src/docs-json.ts
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
function readDocsJson(projectDir) {
  const docsPath = join(projectDir, "docs.json");
  const raw = readFileSync(docsPath, "utf8");
  return JSON.parse(raw);
}
function writeDocsJson(projectDir, config) {
  const docsPath = join(projectDir, "docs.json");
  writeFileSync(docsPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

// src/check.ts
function gitLocal(projectDir, args2) {
  try {
    const out = execFileSync("git", args2, { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { ok: true, out: out.trim() };
  } catch {
    return { ok: false, out: "" };
  }
}
function checkDrift(projectDir, file, data, issues) {
  const sources = data.sources;
  const verifiedCommit = data.verifiedCommit;
  if (!Array.isArray(sources) || sources.length === 0 || typeof verifiedCommit !== "string" || !verifiedCommit.trim()) {
    return;
  }
  const commit = verifiedCommit.trim();
  if (!gitLocal(projectDir, ["cat-file", "-e", `${commit}^{commit}`]).ok) {
    issues.push({
      severity: "warning",
      message: `Cannot verify freshness: verifiedCommit "${commit.slice(0, 8)}" is not in git history \u2014 run with a full clone (fetch-depth: 0).`,
      file
    });
    return;
  }
  for (const src of sources) {
    if (typeof src !== "string" || !src.trim()) continue;
    const colon = src.indexOf(":");
    let filePath = src;
    if (colon > 0) {
      const alias = src.slice(0, colon);
      if (alias !== "." && alias !== "self") {
        issues.push({
          severity: "warning",
          message: `Cross-repo source "${src}" \u2014 drift check skipped (needs the referenced repo; see multi-repo setup).`,
          file
        });
        continue;
      }
      filePath = src.slice(colon + 1);
    }
    filePath = filePath.replace(/^\.\//, "").replace(/#.*$/, "");
    const changed = gitLocal(projectDir, ["log", "--format=%H", `${commit}..HEAD`, "--", filePath]).out;
    if (changed) {
      const n = changed.split("\n").filter(Boolean).length;
      issues.push({
        severity: "warning",
        message: `Drift: source "${src}" changed in ${n} commit(s) since it was verified \u2014 this page may be stale.`,
        file
      });
    }
  }
}
function collectNavPageIds(groups, seen, duplicates) {
  for (const page of groups) {
    if (typeof page === "string") {
      if (seen.has(page)) duplicates.add(page);
      else seen.add(page);
    } else if (page.pages) {
      collectNavPageIds(page.pages, seen, duplicates);
    }
  }
}
function scanMdx(dir, results) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join2(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) scanMdx(fullPath, results);
      else if (extname(entry).toLowerCase() === ".mdx") results.push(fullPath);
    } catch {
    }
  }
}
function addOrphanToNav(projectDir, pageId) {
  const config = readDocsJson(projectDir);
  const tab = config.tabs.find((t) => !t.href && !t.api && t.groups && t.groups.length > 0);
  if (!tab?.groups) return;
  const lastGroup = tab.groups[tab.groups.length - 1];
  const existing = lastGroup.pages.filter((p) => typeof p === "string");
  if (!existing.includes(pageId)) {
    lastGroup.pages.push(pageId);
    writeDocsJson(projectDir, config);
  }
}
function slugify2(text) {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}
function extractHeadingAnchors(content) {
  const anchors = /* @__PURE__ */ new Set();
  for (const line of content.split("\n")) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) anchors.add(slugify2(m[1]));
  }
  return anchors;
}
function extractLinks(content) {
  const links = [];
  const lines = content.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = lines[i].replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      links.push({ target: m[1], line: i + 1 });
    }
    for (const m of line.matchAll(/href=["']([^"']+)["']/g)) {
      links.push({ target: m[1], line: i + 1 });
    }
  }
  return links;
}
function pageIdToPath(pageId) {
  return pageId === "introduction" ? "/" : `/${pageId}`;
}
function validateOpenApi(projectDir, source, issues) {
  const specPath = join2(projectDir, source);
  if (!existsSync(specPath)) {
    issues.push({ severity: "error", message: `API reference points at "${source}" but the file does not exist`, file: source });
    return;
  }
  let spec;
  try {
    const raw = readFileSync2(specPath, "utf8");
    spec = source.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
  } catch (err) {
    issues.push({ severity: "error", message: `OpenAPI spec is not valid ${source.endsWith(".json") ? "JSON" : "YAML"}: ${err.message}`, file: source });
    return;
  }
  const s = spec;
  if (typeof s?.openapi !== "string" && typeof s?.swagger !== "string") {
    issues.push({ severity: "error", message: 'OpenAPI spec is missing the "openapi" (or "swagger") version field', file: source });
  }
  if (typeof s?.info !== "object" || s.info === null) {
    issues.push({ severity: "error", message: 'OpenAPI spec is missing the "info" object', file: source });
  }
  const paths = s?.paths;
  if (typeof paths !== "object" || paths === null) {
    issues.push({ severity: "error", message: 'OpenAPI spec is missing the "paths" object', file: source });
  } else {
    const methods = /* @__PURE__ */ new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
    for (const [p, ops] of Object.entries(paths)) {
      if (typeof ops !== "object" || ops === null) {
        issues.push({ severity: "error", message: `OpenAPI path "${p}" is not an object`, file: source });
        continue;
      }
      const hasOp = Object.keys(ops).some((k) => methods.has(k.toLowerCase()));
      if (!hasOp) {
        issues.push({ severity: "warning", message: `OpenAPI path "${p}" has no operations`, file: source });
      }
    }
  }
}
async function runCheck(projectDir, options) {
  const { fix, ci } = options;
  if (!existsSync(join2(projectDir, "docs.json"))) {
    console.error(`
  \u274C Not a Dox project: docs.json not found in ${projectDir}
`);
    return 1;
  }
  const contentDir = join2(projectDir, "src", "content");
  const issues = [];
  const config = readDocsJson(projectDir);
  const navPageIds = /* @__PURE__ */ new Set();
  const duplicates = /* @__PURE__ */ new Set();
  for (const tab of config.tabs) {
    if (tab.href) {
      if (tab.href.startsWith("/")) navPageIds.add(tab.href.slice(1) || "introduction");
      continue;
    }
    if (tab.api) continue;
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
    const candidates = [join2(contentDir, `${pageId}.mdx`), join2(contentDir, `${pageId}/index.mdx`)];
    if (!candidates.some((c) => existsSync(c))) {
      issues.push({ severity: "error", message: `"${pageId}" is in docs.json but has no MDX file`, file: `src/content/${pageId}.mdx` });
    }
  }
  const allFiles = [];
  if (existsSync(contentDir)) scanMdx(contentDir, allFiles);
  const fixedOrphans = [];
  const validPaths = /* @__PURE__ */ new Set(["/"]);
  const anchorsByPath = /* @__PURE__ */ new Map();
  const linksByFile = [];
  for (const filePath of allFiles) {
    const rel = filePath.slice(contentDir.length + 1).replace(/\.mdx$/, "").replace(/\\/g, "/");
    const pageId = rel.endsWith("/index") ? rel.slice(0, -6) : rel;
    if (!navPageIds.has(pageId)) {
      if (fix) {
        addOrphanToNav(projectDir, pageId);
        fixedOrphans.push(pageId);
      } else {
        issues.push({ severity: "warning", message: `"${pageId}" is not in docs.json nav (orphan)`, file: relative(projectDir, filePath) });
      }
    }
    let data = {};
    let content = "";
    let lineOffset = 0;
    try {
      const raw = readFileSync2(filePath, "utf8");
      const parsed = matter(raw);
      data = parsed.data;
      content = parsed.content;
      lineOffset = raw.slice(0, raw.indexOf(content)).split("\n").length - 1;
    } catch {
      issues.push({ severity: "error", message: `Could not parse frontmatter`, file: relative(projectDir, filePath) });
      continue;
    }
    const rel2 = relative(projectDir, filePath);
    if (!data.title) issues.push({ severity: "warning", message: `Missing "title" in frontmatter`, file: rel2 });
    if (!data.description) issues.push({ severity: "warning", message: `Missing "description" in frontmatter`, file: rel2 });
    if (content.trim().length < 50) issues.push({ severity: "warning", message: `Very short body (${content.trim().length} chars) \u2014 page may be empty`, file: rel2 });
    if (options.drift) checkDrift(projectDir, rel2, data, issues);
    const path = pageIdToPath(pageId);
    const anchors = extractHeadingAnchors(content);
    validPaths.add(path);
    anchorsByPath.set(path, anchors);
    linksByFile.push({ file: rel2, path, anchors, links: extractLinks(content), offset: lineOffset });
  }
  for (const { file, anchors, links, offset } of linksByFile) {
    for (const { target, line: contentLine } of links) {
      const line = contentLine + offset;
      if (/^(https?:|mailto:|tel:)/i.test(target)) continue;
      if (target.startsWith("#")) {
        const anchor2 = target.slice(1);
        if (anchor2 && !anchors.has(anchor2)) {
          issues.push({ severity: "warning", message: `Broken anchor: "${target}" not found on this page`, file, line });
        }
        continue;
      }
      if (!target.startsWith("/")) continue;
      const [beforeHash, anchor] = target.split("#");
      let path = beforeHash.split("?")[0];
      if (path.length > 1) path = path.replace(/\/$/, "");
      if (path.startsWith("/api") || path.startsWith("/_next") || /\.[a-z0-9]+$/i.test(path)) continue;
      if (!validPaths.has(path)) {
        issues.push({ severity: "error", message: `Broken link: "${target}" \u2014 no page at "${path}"`, file, line });
      } else if (anchor && !anchorsByPath.get(path)?.has(anchor)) {
        issues.push({ severity: "warning", message: `Broken anchor: "${target}" \u2014 no heading "#${anchor}" on that page`, file, line });
      }
    }
  }
  for (const tab of config.tabs) {
    if (tab.api?.source) validateOpenApi(projectDir, tab.api.source, issues);
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  if (ci) {
    for (const issue of issues) {
      const loc = issue.file ? `file=${issue.file}${issue.line ? `,line=${issue.line}` : ""}` : "";
      console.log(`::${issue.severity} ${loc}::${issue.message}`);
    }
    console.log(`
dox check: ${errors.length} error(s), ${warnings.length} warning(s)`);
    return errors.length > 0 ? 1 : 0;
  }
  console.log(`
  Linting ${projectDir}...
`);
  if (errors.length === 0 && warnings.length === 0 && fixedOrphans.length === 0) {
    console.log("  \u2705 No issues found.\n");
    return 0;
  }
  console.log(`  \u274C ${errors.length} error${errors.length !== 1 ? "s" : ""}, \u26A0\uFE0F  ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}
`);
  if (errors.length > 0) {
    console.log("  ERRORS:");
    for (const issue of errors) {
      console.log(`    ${issue.message}`);
      if (issue.file) console.log(`    \u2192 ${issue.file}${issue.line ? `:${issue.line}` : ""}`);
    }
    console.log("");
  }
  if (warnings.length > 0) {
    console.log("  WARNINGS:");
    for (const issue of warnings) {
      console.log(`    ${issue.message}`);
      if (issue.file) console.log(`    \u2192 ${issue.file}${issue.line ? `:${issue.line}` : ""}`);
    }
    console.log("");
  }
  if (fixedOrphans.length > 0) {
    console.log(`  \u2705 Auto-fixed ${fixedOrphans.length} orphan page${fixedOrphans.length > 1 ? "s" : ""} (added to nav):`);
    for (const p of fixedOrphans) console.log(`    + ${p}`);
    console.log("");
  }
  if (!fix && warnings.some((w) => w.message.includes("orphan"))) {
    console.log("  Tip: run with --fix to auto-add orphan pages to navigation.\n");
  }
  return errors.length > 0 ? 1 : 0;
}

// src/translate.ts
import { readFileSync as readFileSync3, writeFileSync as writeFileSync2, existsSync as existsSync2, mkdirSync } from "fs";
import { join as join3, dirname } from "path";
import { input as input2 } from "@inquirer/prompts";
import matter2 from "gray-matter";
import Anthropic from "@anthropic-ai/sdk";
import pLimit from "p-limit";
function readDocsJson2(projectDir) {
  const docsPath = join3(projectDir, "docs.json");
  const raw = readFileSync3(docsPath, "utf8");
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
  const skippedApiTabs = [];
  const hrefOnlyPages = [];
  for (const tab of config.tabs) {
    if (tab.api) {
      skippedApiTabs.push(tab.tab);
      continue;
    }
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
  return { ids, skippedApiTabs, hrefOnlyPages };
}
function findSourceFile(projectDir, pageId) {
  const contentRoot = join3(projectDir, "src", "content");
  const candidates = [
    join3(contentRoot, `${pageId}.mdx`),
    join3(contentRoot, `${pageId}/index.mdx`)
  ];
  return candidates.find((p) => existsSync2(p)) ?? null;
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
10. Output ONLY the translated MDX file content \u2014 no preamble, no explanation, no markdown fences.

Example (translating to Spanish):
Input frontmatter:
  title: Getting Started
  description: Learn how to use the SDK.
Output frontmatter:
  title: Comenzando
  description: Aprende a usar el SDK.

Input MDX body:
  ## Installation
  Run the following command:
  \`\`\`bash
  npm install my-sdk
  \`\`\`
  <Note>This is important.</Note>
Output MDX body:
  ## Instalaci\xF3n
  Ejecuta el siguiente comando:
  \`\`\`bash
  npm install my-sdk
  \`\`\`
  <Note>Esto es importante.</Note>`;
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
async function runTranslateCommand(locale, pages, force, apiKey, model, yes, projectDir) {
  const config = readDocsJson2(projectDir);
  if (!config.i18n) {
    console.error("\n  \u274C No i18n config found in docs.json.");
    console.error('     Add an "i18n" block to docs.json first:');
    console.error("     {");
    console.error('       "i18n": {');
    console.error('         "defaultLocale": "en",');
    console.error('         "locales": [{"code":"en","label":"English"},{"code":"es","label":"Espa\xF1ol"}]');
    console.error("       }");
    console.error("     }");
    process.exit(1);
  }
  const targetLocale = config.i18n.locales.find((l) => l.code === locale);
  if (!targetLocale) {
    const available = config.i18n.locales.map((l) => l.code).join(", ");
    console.error(`
  \u274C Locale "${locale}" not found in docs.json i18n config.`);
    console.error(`     Available locales: ${available}`);
    process.exit(1);
  }
  if (locale === config.i18n.defaultLocale) {
    console.error(`
  \u274C Cannot translate to the default locale "${locale}".`);
    process.exit(1);
  }
  if (!apiKey) {
    console.error("\n  \u274C Anthropic API key required. Set ANTHROPIC_API_KEY or pass --api-key.");
    process.exit(1);
  }
  const { ids: allPageIds, skippedApiTabs, hrefOnlyPages } = getAllPageIds(config);
  if (skippedApiTabs.length > 0) {
    console.log(`  \u2139  Skipping API reference tab(s): ${skippedApiTabs.join(", ")}`);
    console.log("     API reference pages are auto-generated from your OpenAPI spec and cannot be translated as MDX files.");
    console.log("");
  }
  if (hrefOnlyPages.length > 0) {
    const labels = hrefOnlyPages.map(({ tab, pageId }) => `${tab} (${pageId}.mdx)`).join(", ");
    console.log(`  \u2139  Including standalone tab page(s): ${labels}`);
    console.log("");
  }
  const targetPageIds = pages ?? allPageIds;
  const contentRoot = join3(projectDir, "src", "content");
  const toTranslate = [];
  for (const pageId of targetPageIds) {
    const sourceFile = findSourceFile(projectDir, pageId);
    if (!sourceFile) {
      console.warn(`  \u26A0  Page "${pageId}" not found in src/content \u2014 skipping.`);
      continue;
    }
    const relativeFromContent = sourceFile.slice(contentRoot.length + 1);
    const targetFile = join3(contentRoot, locale, relativeFromContent);
    if (existsSync2(targetFile) && !force) {
      console.log(`  \u23ED  ${pageId} (already translated, use --force to overwrite)`);
      continue;
    }
    toTranslate.push({ pageId, sourceFile, targetFile });
  }
  if (toTranslate.length === 0) {
    console.log("\n  \u2705 Nothing to translate.");
    return;
  }
  console.log(`
  \u{1F4CB} ${toTranslate.length} page(s) to translate to ${targetLocale.label} (${locale}):`);
  for (const { pageId } of toTranslate) {
    console.log(`     \u2022 ${pageId}`);
  }
  console.log("");
  if (!yes) {
    const confirm = await input2({
      message: "  Proceed? (Y/n):",
      default: "Y"
    });
    if (confirm.toLowerCase() === "n") {
      console.log("\n  Aborted.");
      return;
    }
  }
  const client = new Anthropic({ apiKey });
  const limit = pLimit(3);
  let doneCount = 0;
  const total = toTranslate.length;
  await Promise.all(
    toTranslate.map(
      ({ pageId, sourceFile, targetFile }) => limit(async () => {
        try {
          const sourceContent = readFileSync3(sourceFile, "utf8");
          const parsed = matter2(sourceContent);
          if (!parsed.data.title) {
            console.warn(`  \u26A0  ${pageId}: missing title in frontmatter \u2014 translating anyway`);
          }
          const translated = await translatePage(
            sourceContent,
            targetLocale.label,
            locale,
            model,
            client
          );
          mkdirSync(dirname(targetFile), { recursive: true });
          writeFileSync2(targetFile, translated + "\n", "utf8");
          doneCount++;
          console.log(`  \u2713 [${doneCount}/${total}] ${pageId}`);
        } catch (err) {
          doneCount++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  \u2717 [${doneCount}/${total}] ${pageId}: ${msg}`);
        }
      })
    )
  );
  console.log("");
  console.log(`  \u2705 Translation complete! ${doneCount}/${total} pages translated.`);
  console.log(`     Files written to: src/content/${locale}/`);
}

// src/index.ts
var args = process.argv.slice(2);
var flags = args.filter((a) => a.startsWith("-"));
var positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("-")) {
    if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
      i++;
    }
  } else {
    positional.push(args[i]);
  }
}
function getFlagValue(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("-")) {
    return args[idx + 1];
  }
  return void 0;
}
async function runMigrateCommand() {
  const sourceUrl = positional[1];
  if (!sourceUrl) {
    console.error("\n  \u274C Source URL is required.");
    console.error("     Usage: create-dox migrate <github-url> [output-dir] [options]");
    console.error("     Example: create-dox migrate https://github.com/mintlify/docs my-docs");
    process.exit(1);
  }
  let parsedSource;
  try {
    parsedSource = parseGitHubUrl(sourceUrl);
  } catch (err) {
    console.error(`
  \u274C ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const apiKey = getFlagValue("--api-key") ?? process.env.ANTHROPIC_API_KEY;
  const intoDir = getFlagValue("--into");
  const isInto = Boolean(intoDir);
  let projectDir;
  if (intoDir) {
    projectDir = resolve2(intoDir);
  } else if (positional[2]) {
    projectDir = resolve2(positional[2]);
  } else {
    projectDir = resolve2(`${slugify(parsedSource.repo)}-docs`);
  }
  const branch = getFlagValue("--branch");
  const docsDir = getFlagValue("--docs-dir");
  const yes = flags.includes("--yes") || flags.includes("-y");
  logo();
  console.log("  \u{1F680} Dox Migrate");
  console.log("");
  console.log(`  Source:  ${sourceUrl}`);
  console.log(`  Target:  ${projectDir}`);
  if (branch) console.log(`  Branch:  ${branch}`);
  if (docsDir) console.log(`  Docs dir: ${docsDir}`);
  console.log("");
  if (!apiKey) {
    console.warn("  \u26A0  No API key provided. Non-Markdown files will be skipped.");
    console.warn("     Set ANTHROPIC_API_KEY=... or pass --api-key <key> to convert them.");
    console.warn("");
  }
  await migrateDocs({
    sourceUrl,
    projectDir,
    into: isInto,
    apiKey,
    branch,
    docsDir,
    yes
  });
}
async function runScaffoldCommand() {
  const useDefaults = flags.includes("--yes") || flags.includes("-y");
  const dirArg = positional[0];
  if (dirArg) {
    const resolved = resolve2(dirArg);
    if (existsSync3(resolved) && readdirSync2(resolved).length > 0) {
      console.error(`
  \u274C Directory "${resolved}" already exists and is not empty.`);
      process.exit(1);
    }
  }
  const answers = await gatherAnswers(dirArg, useDefaults);
  const result = await scaffold({
    projectDir: answers.projectDir,
    projectName: answers.projectName,
    description: answers.description,
    brandPreset: answers.brandPreset,
    repoUrl: answers.repoUrl,
    doInstall: answers.doInstall,
    i18nLocales: answers.i18nLocales
  });
  success(result.projectDir, answers.projectName);
}
async function runCheckCommand() {
  const projectDir = resolve2(positional[1] ?? ".");
  const exitCode = await runCheck(projectDir, {
    fix: flags.includes("--fix"),
    ci: flags.includes("--ci"),
    external: flags.includes("--external"),
    drift: flags.includes("--drift")
  });
  process.exit(exitCode);
}
async function runTranslateSubcommand() {
  const locale = getFlagValue("--locale");
  if (!locale) {
    console.error("\n  \u274C --locale is required.");
    console.error("     Usage: create-dox translate --locale es [--pages page1,page2] [--force] [--api-key key]");
    process.exit(1);
  }
  const pagesArg = getFlagValue("--pages");
  const pages = pagesArg ? pagesArg.split(",").map((p) => p.trim()).filter(Boolean) : void 0;
  const force = flags.includes("--force");
  const apiKey = getFlagValue("--api-key") ?? process.env.ANTHROPIC_API_KEY;
  const model = getFlagValue("--model") ?? "claude-sonnet-4-6";
  const yes = flags.includes("--yes") || flags.includes("-y");
  const projectDir = resolve2(positional[1] ?? ".");
  logo();
  console.log("  \u{1F310} Dox Translate");
  console.log("");
  await runTranslateCommand(locale, pages, force, apiKey, model, yes, projectDir);
}
async function main() {
  const subcommand = positional[0];
  if (subcommand === "migrate") {
    await runMigrateCommand();
  } else if (subcommand === "check") {
    await runCheckCommand();
  } else if (subcommand === "translate") {
    await runTranslateSubcommand();
  } else {
    logo();
    await runScaffoldCommand();
  }
}
main().catch((err) => {
  console.error("\n  \u274C Error:", err.message);
  process.exit(1);
});
