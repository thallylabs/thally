/** Runtime-to-starter synchronization contract coverage. */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// This workflow bootstrap intentionally stays dependency-free JavaScript so
// GitHub Actions can run it before npm install.
// @ts-expect-error -- the checked-in .mjs module has no declaration file.
import {
  FRAMEWORK_SYNC_ELIGIBLE,
  checkStarterRuntimeContract,
  syncStarterRuntimeContract,
} from "../../../../.github/scripts/starter-runtime-contract.mjs";

const temporaryDirectories: Array<string> = [];

function temporaryDirectory(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), `${name}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function write(root: string, path: string, content: string): void {
  const destination = join(root, path);
  mkdirSync(join(destination, ".."), { recursive: true });
  writeFileSync(destination, content, "utf8");
}

function writeCoreLock(
  starterDirectory: string,
  core: { version: string; constraint: string },
): void {
  write(
    starterDirectory,
    "package-lock.json",
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          "": { dependencies: { "@thallylabs/core": core.constraint } },
          "node_modules/@thallylabs/core": { version: core.version },
        },
      },
      null,
      2,
    )}\n`,
  );
}

function createRuntime(): {
  directory: string;
  commitSha: string;
  treeSha: string;
} {
  const directory = temporaryDirectory("thally-runtime-contract");
  write(directory, "BUILD-WARNINGS.md", "# Build warning register\n");
  write(directory, "src/components/top-bar.tsx", "export const height = 56\n");
  write(directory, "src/lib/runtime.ts", "export const runtime = true\n");
  write(
    directory,
    "packages/core/package.json",
    `${JSON.stringify({ name: "@thallylabs/core", version: "0.2.3" }, null, 2)}\n`,
  );
  write(
    directory,
    "src/lib/__tests__/frontmatter-parity.test.ts",
    "import '../../../packages/core'\n",
  );
  execFileSync("git", ["init", "-q"], { cwd: directory });
  execFileSync("git", ["add", "."], { cwd: directory });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "runtime",
    ],
    { cwd: directory },
  );
  return {
    directory,
    commitSha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
    }).trim(),
    treeSha: execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: directory,
      encoding: "utf8",
    }).trim(),
  };
}

function createStarter(
  runtime: ReturnType<typeof createRuntime>,
  rules?: Array<string>,
): string {
  const directory = temporaryDirectory("thally-starter-contract");
  write(directory, "src/components/top-bar.tsx", "export const height = 48\n");
  write(directory, "src/components/removed.tsx", "stale\n");
  write(
    directory,
    "src/lib/__tests__/frontmatter-parity.test.ts",
    "import '../../../packages/core'\n",
  );
  write(
    directory,
    "package.json",
    `${JSON.stringify({ dependencies: { "@thallylabs/core": "^0.2.2" } }, null, 2)}\n`,
  );
  writeCoreLock(directory, { version: "0.2.2", constraint: "^0.2.2" });
  write(
    directory,
    "starter-release.json",
    `${JSON.stringify(
      {
        schemaVersion: 1,
        starterVersion: 1,
        repository: "thallylabs/starter",
        defaultBranch: "main",
        runtime: {
          repository: "thallylabs/thally",
          commitSha: "0".repeat(40),
          treeSha: "1".repeat(40),
        },
        packages: { "@thallylabs/core": "^0.2.2" },
        ownership: {
          frameworkSyncEligible: rules ?? FRAMEWORK_SYNC_ELIGIBLE,
          userOwnedNeverOverwrite: ["src/content/**"],
          manualReview: [],
        },
      },
      null,
      2,
    )}\n`,
  );
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("starter runtime contract", () => {
  it("detects provenance, changed files, missing files, and stale files", () => {
    const runtime = createRuntime();
    const starterDirectory = createStarter(runtime);

    const result = checkStarterRuntimeContract({
      starterDirectory,
      runtimeDirectory: runtime.directory,
    });

    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.stringContaining("starter-release.json pins"),
        "src/components/removed.tsx exists only in starter",
        "src/components/top-bar.tsx bytes differ",
        "src/lib/runtime.ts is missing from starter",
        "BUILD-WARNINGS.md is missing from starter",
        "src/lib/__tests__/frontmatter-parity.test.ts is source-only but exists in starter",
      ]),
    );
  });

  it("generates a byte-identical snapshot and exact runtime pin", () => {
    const runtime = createRuntime();
    const starterDirectory = createStarter(runtime);

    syncStarterRuntimeContract({
      starterDirectory,
      runtimeDirectory: runtime.directory,
      refreshLockfile: writeCoreLock,
    });

    expect(
      checkStarterRuntimeContract({
        starterDirectory,
        runtimeDirectory: runtime.directory,
      }).differences,
    ).toEqual([]);
    expect(
      readFileSync(
        join(starterDirectory, "src/components/top-bar.tsx"),
        "utf8",
      ),
    ).toBe("export const height = 56\n");
    expect(readFileSync(join(starterDirectory, "BUILD-WARNINGS.md"), "utf8")).toBe(
      "# Build warning register\n",
    );
    expect(() =>
      readFileSync(
        join(starterDirectory, "src/lib/__tests__/frontmatter-parity.test.ts"),
        "utf8",
      ),
    ).toThrow();
    const manifest = JSON.parse(
      readFileSync(join(starterDirectory, "starter-release.json"), "utf8"),
    );
    expect(manifest.runtime).toEqual({
      repository: "thallylabs/thally",
      commitSha: runtime.commitSha,
      treeSha: runtime.treeSha,
    });
    expect(manifest.packages).toEqual({ "@thallylabs/core": "^0.2.3" });
    expect(
      JSON.parse(readFileSync(join(starterDirectory, "package.json"), "utf8"))
        .dependencies["@thallylabs/core"],
    ).toBe("^0.2.3");
    const lock = JSON.parse(
      readFileSync(join(starterDirectory, "package-lock.json"), "utf8"),
    );
    expect(lock.packages[""].dependencies["@thallylabs/core"]).toBe("^0.2.3");
    expect(lock.packages["node_modules/@thallylabs/core"].version).toBe(
      "0.2.3",
    );
  });

  it("rejects a stale dependency lock even when package metadata is current", () => {
    const runtime = createRuntime();
    const starterDirectory = createStarter(runtime);
    syncStarterRuntimeContract({
      starterDirectory,
      runtimeDirectory: runtime.directory,
      refreshLockfile: writeCoreLock,
    });
    writeCoreLock(starterDirectory, {
      version: "0.2.2",
      constraint: "^0.2.3",
    });

    expect(
      checkStarterRuntimeContract({
        starterDirectory,
        runtimeDirectory: runtime.directory,
      }).differences,
    ).toContain(
      "package-lock.json resolves @thallylabs/core 0.2.2, expected 0.2.3",
    );
  });

  it("rejects ownership rules that can escape or ambiguously expand", () => {
    const runtime = createRuntime();
    const starterDirectory = createStarter(runtime, ["../**"]);

    expect(() =>
      checkStarterRuntimeContract({
        starterDirectory,
        runtimeDirectory: runtime.directory,
      }),
    ).toThrow("escapes the repository");
  });

  it("rejects a safe but unauthorized expansion of runtime ownership", () => {
    const runtime = createRuntime();
    const starterDirectory = createStarter(runtime, [
      ...FRAMEWORK_SYNC_ELIGIBLE,
      "src/content/**",
    ]);

    expect(() =>
      checkStarterRuntimeContract({
        starterDirectory,
        runtimeDirectory: runtime.directory,
      }),
    ).toThrow("canonical contract");
  });

  it("refuses to snapshot uncommitted runtime files", () => {
    const runtime = createRuntime();
    const starterDirectory = createStarter(runtime);
    write(
      runtime.directory,
      "src/lib/uncommitted.ts",
      "export const dirty = true\n",
    );

    expect(() =>
      syncStarterRuntimeContract({
        starterDirectory,
        runtimeDirectory: runtime.directory,
      }),
    ).toThrow("dirty runtime checkout");
  });

  it("refuses to write through a symbolic-link ancestor", () => {
    const runtime = createRuntime();
    const starterDirectory = createStarter(runtime);
    const externalDirectory = temporaryDirectory("thally-external");
    rmSync(join(starterDirectory, "src"), { force: true, recursive: true });
    symlinkSync(externalDirectory, join(starterDirectory, "src"));

    expect(() =>
      syncStarterRuntimeContract({
        starterDirectory,
        runtimeDirectory: runtime.directory,
      }),
    ).toThrow("symbolic-link ancestor");
  });
});
