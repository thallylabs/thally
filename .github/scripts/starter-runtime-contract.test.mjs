/** Standalone snapshots retain every owned runtime asset and reject source-only files or ownership drift. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { FRAMEWORK_SYNC_ELIGIBLE, checkStarterRuntimeContract, isSourceOnlyPath, syncStarterRuntimeContract } from "./starter-runtime-contract.mjs";

// The compatibility fixture is deliberately frozen independently of the current
// contract: a future rule must not silently change which old archives pass.
const PRE_GRAMMAR_RULES = [
  "BUILD-WARNINGS.md", "src/app/**", "src/cloud/**", "src/components/**", "src/config/**",
  "src/data/api-reference.ts", "src/data/docs.ts", "src/data/get-doc.ts", "src/data/manual-api.ts", "src/lib/**",
  "src/mdx/rehype.ts", "src/mdx/rehype.test.ts", "src/mdx/__tests__/test-html.ts", "src/mdx/remark.ts",
  "src/mdx/smart-quotes.ts", "src/mdx/smart-quotes.test.ts", "src/mdx/snippet-registry.ts", "src/styles/**",
  "src/test/**", "src/middleware.ts", "mdx-components.tsx", "tailwind.config.ts", "starter-release.json",
  "scripts/agent-readiness.ts", "scripts/build-cloudflare.mts", "scripts/build-embeddings.ts",
  "scripts/build-runtime-sources.mts", "scripts/lib/**", "scripts/check-cloudflare-worker-size.mts",
  "scripts/smoke-cloudflare.mts", "scripts/mint-reader-token.ts",
];

/** Create one clean, immutable runtime and its portable starter without external dependencies or a lockfile install. */
function contractFixture(t, { grammars = false, ownership = FRAMEWORK_SYNC_ELIGIBLE, danglingGrammar = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "thally-grammar-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtimeDirectory = join(root, "runtime");
  const starterDirectory = join(root, "starter");
  const write = (directory, path, value) => {
    const destination = join(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  };
  const version = "1.2.3";
  const dependencies = { "@thallylabs/core": `^${version}` };
  write(runtimeDirectory, "packages/core/package.json", { name: "@thallylabs/core", version });
  write(runtimeDirectory, "src/mdx/rehype.ts", "export const renderer = true;\n");
  const assets = ["baml.tmLanguage.json", "baml-jinja.tmLanguage.json", "LICENSE", "NOTICE"];
  if (grammars) {
    for (const asset of assets) {
      write(runtimeDirectory, `src/mdx/grammars/${asset}`, readFileSync(new URL(`../../src/mdx/grammars/${asset}`, import.meta.url)));
    }
  }
  if (danglingGrammar) {
    mkdirSync(join(runtimeDirectory, "src/mdx"), { recursive: true });
    symlinkSync("missing-grammar-directory", join(runtimeDirectory, "src/mdx/grammars"));
  }
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", runtimeDirectory, ...args], {
    encoding: "utf8",
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
  write(starterDirectory, "starter-release.json", {
    schemaVersion: 1, starterVersion: 3, repository: "thallylabs/starter",
    runtime: { repository: "thallylabs/thally", commitSha: git("rev-parse", "HEAD"), treeSha: git("rev-parse", "HEAD^{tree}") },
    ownership: { frameworkSyncEligible: ownership }, packages: dependencies,
  });
  write(starterDirectory, "package.json", { dependencies });
  write(starterDirectory, "package-lock.json", { packages: { "": { dependencies }, "node_modules/@thallylabs/core": { version } } });
  write(starterDirectory, "src/mdx/rehype.ts", "export const renderer = true;\n");
  return {
    starterDirectory, runtimeDirectory, assets,
    check: () => checkStarterRuntimeContract({ starterDirectory, runtimeDirectory }),
    sync: () => syncStarterRuntimeContract({ starterDirectory, runtimeDirectory, refreshLockfile: () => {} }),
  };
}

test("rejects monorepo integration tests already present in a standalone snapshot", () => {
  const runtimeDirectory = fileURLToPath(new URL("../../", import.meta.url));
  const starterDirectory = mkdtempSync(join(tmpdir(), "thally-starter-source-only-"));
  const sourceOnly = [
    "src/components/mdx/steps-toc.test.tsx",
    "src/lib/__tests__/url-migration-runtime-fidelity.test.ts",
    "src/lib/openapi/__tests__/migrate-withheld-operations-parity.test.ts",
  ];
  const write = (path, value) => {
    const destination = join(starterDirectory, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, typeof value === "string" ? value : JSON.stringify(value));
  };
  try {
    const { version } = JSON.parse(readFileSync(join(runtimeDirectory, "packages/core/package.json"), "utf8"));
    const dependencies = { "@thallylabs/core": `^${version}` };
    write("starter-release.json", {
      schemaVersion: 1,
      repository: "thallylabs/starter",
      runtime: { repository: "thallylabs/thally" },
      ownership: { frameworkSyncEligible: FRAMEWORK_SYNC_ELIGIBLE },
      packages: dependencies,
    });
    write("package.json", { dependencies });
    write("package-lock.json", { packages: { "": { dependencies }, "node_modules/@thallylabs/core": { version } } });
    for (const path of sourceOnly) write(path, "stale integration test");
    const { differences } = checkStarterRuntimeContract({ starterDirectory, runtimeDirectory });
    assert.deepEqual(
      differences.filter((difference) => difference.includes("is source-only" )).sort(),
      sourceOnly.map((path) => `${path} is source-only but exists in starter`).sort(),
    );
  } finally {
    rmSync(starterDirectory, { recursive: true, force: true });
  }
});

// Test coverage stays with the engine, including new suites added in the future.
test("excludes every framework test and fixture without excluding runtime modules", () => {
  for (const path of ["src/app/route.test.ts", "src/components/card.spec.tsx", "src/lib/__tests__/helper.ts", "src/lib/__fixtures__/doc.mdx", "src/test/server-only.ts", "scripts/lib/build.test.mts"]) {
    assert.equal(isSourceOnlyPath(path), true, path);
  }
  for (const path of ["src/lib/testing.ts", "src/lib/runtime.ts", "scripts/build-runtime-sources.mts"]) {
    assert.equal(isSourceOnlyPath(path), false, path);
  }
});

test("synchronizes every grammar asset and attribution file byte-for-byte without taking customer MDX", (t) => {
  const fixture = contractFixture(t, { grammars: true, ownership: PRE_GRAMMAR_RULES });
  const customerPath = join(fixture.starterDirectory, "src/mdx/custom-components.tsx");
  writeFileSync(customerPath, "customer components\n");
  assert.deepEqual(fixture.sync().differences, []);
  assert.deepEqual(fixture.check().differences, []);
  const manifest = JSON.parse(readFileSync(join(fixture.starterDirectory, "starter-release.json"), "utf8"));
  assert.deepEqual(manifest.ownership.frameworkSyncEligible, FRAMEWORK_SYNC_ELIGIBLE);
  assert.equal(manifest.starterVersion, 3);
  assert.equal(readFileSync(customerPath, "utf8"), "customer components\n");
  assert.equal(FRAMEWORK_SYNC_ELIGIBLE.includes("src/mdx/**"), false);
  for (const asset of fixture.assets) {
    const path = `src/mdx/grammars/${asset}`;
    assert.deepEqual(readFileSync(join(fixture.starterDirectory, path)), readFileSync(join(fixture.runtimeDirectory, path)), path);
  }
});

test("rejects missing grammar JSON and modified license or notice files", (t) => {
  const fixture = contractFixture(t, { grammars: true });
  fixture.sync();
  rmSync(join(fixture.starterDirectory, "src/mdx/grammars/baml.tmLanguage.json"));
  for (const asset of ["baml-jinja.tmLanguage.json", "LICENSE", "NOTICE"]) {
    writeFileSync(join(fixture.starterDirectory, `src/mdx/grammars/${asset}`), "altered\n");
  }
  assert.deepEqual(fixture.check().differences.sort(), [
    "src/mdx/grammars/baml.tmLanguage.json is missing from starter",
    ...["baml-jinja.tmLanguage.json", "LICENSE", "NOTICE"].map((asset) => `src/mdx/grammars/${asset} bytes differ`),
  ].sort());
});

test("accepts exactly the historical ownership inventory for a runtime with no grammar path", (t) => {
  const fixture = contractFixture(t, { ownership: PRE_GRAMMAR_RULES });
  assert.deepEqual(fixture.check().differences, []);
  writeFileSync(join(fixture.starterDirectory, "src/mdx/rehype.ts"), "altered renderer\n");
  assert.deepEqual(fixture.check().differences, ["src/mdx/rehype.ts bytes differ"]);
});

test("keeps the current complete inventory valid for a pre-grammar runtime", (t) => {
  const fixture = contractFixture(t);
  assert.deepEqual(fixture.check().differences, []);
});

test("rejects historical ownership when the pinned runtime contains grammar assets", (t) => {
  const fixture = contractFixture(t, { grammars: true, ownership: PRE_GRAMMAR_RULES });
  assert.throws(fixture.check, /runtime ownership does not match the canonical contract/);
});

test("does not admit historical ownership after committed grammar assets are deleted from the checkout", (t) => {
  const fixture = contractFixture(t, { grammars: true, ownership: PRE_GRAMMAR_RULES });
  rmSync(join(fixture.runtimeDirectory, "src/mdx/grammars"), { recursive: true });
  assert.throws(fixture.check, /runtime ownership does not match the canonical contract/);
});

test("fails historical ownership validation closed when the pinned Git tree cannot be read", (t) => {
  const fixture = contractFixture(t, { ownership: PRE_GRAMMAR_RULES });
  rmSync(join(fixture.runtimeDirectory, ".git"), { recursive: true });
  assert.throws(fixture.check, /runtime ownership does not match the canonical contract/);
});

test("does not mistake a dangling grammar symlink for a pre-grammar runtime", (t) => {
  const fixture = contractFixture(t, { danglingGrammar: true, ownership: PRE_GRAMMAR_RULES });
  assert.throws(fixture.check, /runtime ownership does not match the canonical contract/);
});

test("rejects unrelated ownership drift even for a runtime without grammar assets", (t) => {
  for (const ownership of [
    [...PRE_GRAMMAR_RULES, "src/mdx/**"],
    PRE_GRAMMAR_RULES.filter((rule) => rule !== "src/lib/**"),
    [...PRE_GRAMMAR_RULES].reverse(),
  ]) {
    const fixture = contractFixture(t, { ownership });
    assert.throws(fixture.check, /runtime ownership does not match the canonical contract/);
  }
});

test("owns every non-test runtime asset under the partially owned MDX directory", () => {
  const runtimeDirectory = fileURLToPath(new URL("../../", import.meta.url));
  const walk = (directory) => readdirSync(join(runtimeDirectory, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  });
  for (const path of walk("src/mdx")) {
    if (isSourceOnlyPath(path) || path === "src/mdx/custom-components.tsx" || path.startsWith("src/mdx/migrated/")) continue;
    const owned = FRAMEWORK_SYNC_ELIGIBLE.some((rule) => rule === path || (rule.endsWith("/**") && path.startsWith(`${rule.slice(0, -3)}/`)));
    assert.equal(owned, true, `${path} must have an explicit runtime ownership rule`);
  }
});
