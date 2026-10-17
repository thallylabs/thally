// ---------------------------------------------------------------------------
// Thally Track — GitHub API access.
//
// GitHub App and personal-token authentication plus the pull-request fetchers.
// Moved verbatim from the original single-file module; every export keeps its
// name and signature because Thally Cloud and the CLI import them directly.
// ---------------------------------------------------------------------------

import { createSign, createHash } from "node:crypto";
import type { PrFile, PullRequestInfo } from "./shared.js";

export interface OwnerRepoRef {
  owner: string;
  repo: string;
  /** Present when the spec pinned a PR number (`owner/repo#123`). */
  pr?: number;
}

/**
 * Parse a tracked-repo spec: `owner/repo`, `owner/repo#123`, or a github.com
 * URL (`https://github.com/owner/repo(.git)`, optionally `.../pull/123`).
 * Returns null for anything else.
 */
export function parseOwnerRepo(spec: string): OwnerRepoRef | null {
  const trimmed = spec.trim();
  // Capture a PR number from a /pull/<n> URL path BEFORE the trailing catch-all.
  const url = trimmed.match(
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/pull\/(\d+))?(?:[/#?].*)?$/i,
  );
  if (url)
    return {
      owner: url[1],
      repo: url[2],
      ...(url[3] ? { pr: Number(url[3]) } : {}),
    };
  const plain = trimmed.match(
    /^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:#(\d+))?$/,
  );
  if (!plain) return null;
  return {
    owner: plain[1],
    repo: plain[2],
    ...(plain[3] ? { pr: Number(plain[3]) } : {}),
  };
}

/** GitHub App installation credentials (the "Connect GitHub" path). */
export interface GithubAppCreds {
  appId: string | number;
  installationId: string | number;
  /** PEM-encoded private key (PKCS#1 or PKCS#8). */
  privateKey: string;
}

export interface GithubFetchOptions {
  /** Overrides the token resolver entirely. */
  token?: string;
  /** GitHub App creds to mint an installation token from (used before the PAT chain). */
  appCreds?: GithubAppCreds;
  /** Injectable for tests — defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Installation tokens last ~1h; cache per installation until just before expiry
// so a burst of API calls in one request doesn't re-mint.
const installationTokenCache = new Map<
  string,
  { token: string; expiresAtMs: number }
>();

/**
 * Sign an App-level RS256 JWT (iss = appId) — authenticates AS THE APP for the
 * App API (installation lookups, token exchange). Lives at most 10 min.
 */
export function createAppJwt(
  appId: string | number,
  privateKey: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat backdated 60s for clock skew.
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(appId) }),
  );
  const signature = base64url(
    createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey),
  );
  return `${header}.${payload}.${signature}`;
}

/**
 * Mint a GitHub App installation access token: sign an App JWT, then exchange it
 * for a short-lived, repo-scoped installation token. Dependency-free
 * (node:crypto). Cached per (app, installation, key) — so a key rotation or a
 * reconnect never serves a token minted from stale credentials.
 */
export async function mintInstallationToken(
  creds: GithubAppCreds,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  // Fingerprint the key so a rotated key (same app + installation id) misses the
  // cache instead of returning a token the admin believes revoked.
  const keyFp = createHash("sha256")
    .update(creds.privateKey)
    .digest("hex")
    .slice(0, 12);
  const cacheKey = `${creds.appId}:${creds.installationId}:${keyFp}`;
  const cached = installationTokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - 60_000 > Date.now()) return cached.token;

  const jwt = createAppJwt(creds.appId, creds.privateKey);
  const res = await fetchImpl(
    `https://api.github.com/app/installations/${creds.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      `GitHub App token exchange failed (${res.status}) — check the app id, installation id, and private key.`,
    );
  }
  const body = (await res.json()) as { token: string; expires_at: string };
  // Guard an unparseable expires_at (NaN) so the cache still works (fall back to
  // a conservative 30-min TTL rather than a NaN that re-mints on every call).
  const parsed = Date.parse(body.expires_at);
  const expiresAtMs = Number.isFinite(parsed)
    ? parsed
    : Date.now() + 30 * 60 * 1000;
  installationTokenCache.set(cacheKey, { token: body.token, expiresAtMs });
  return body.token;
}

/**
 * Confirm an installation id genuinely belongs to this app (authenticated as the
 * app). Used by the "Connect GitHub" callback to accept a post-install
 * `installation_id` WITHOUT trusting the query param alone — an attacker-forged
 * or foreign id fails this check, closing the CSRF hole on the install step.
 */
export async function verifyInstallationBelongsToApp(
  appId: string | number,
  privateKey: string,
  installationId: string | number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const jwt = createAppJwt(appId, privateKey);
  const res = await fetchImpl(
    `https://api.github.com/app/installations/${installationId}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
      },
    },
  );
  if (!res.ok) return false;
  const body = (await res.json()) as { app_id?: number | string };
  return String(body.app_id) === String(appId);
}

/** GitHub App creds from env, when the "Connect GitHub" flow isn't used. */
function envAppCreds(): GithubAppCreds | undefined {
  const appId = (
    process.env.THALLY_GITHUB_APP_ID ?? process.env.DOX_GITHUB_APP_ID
  )?.trim();
  const installationId = (
    process.env.THALLY_GITHUB_APP_INSTALLATION_ID ??
    process.env.DOX_GITHUB_APP_INSTALLATION_ID
  )?.trim();
  const privateKey =
    process.env.THALLY_GITHUB_APP_PRIVATE_KEY ??
    process.env.DOX_GITHUB_APP_PRIVATE_KEY;
  if (appId && installationId && privateKey)
    return { appId, installationId, privateKey };
  return undefined;
}

/**
 * Resolve a GitHub API token. Precedence: an explicit token → a GitHub App
 * installation token (passed creds, then env creds) → the personal-token chain
 * (`THALLY_GITHUB_TOKEN → THALLY_TASKS_TOKEN → GH_TOKEN → GITHUB_TOKEN`, each
 * `THALLY_*` falling back to its legacy `DOX_*` name). One resolver
 * for every Track call site so the chain never drifts.
 */
export async function resolveGithubToken(
  options?: GithubFetchOptions,
): Promise<string | undefined> {
  if (options?.token) return options.token;
  const pat =
    process.env.THALLY_GITHUB_TOKEN ??
    process.env.DOX_GITHUB_TOKEN ??
    process.env.THALLY_TASKS_TOKEN ??
    process.env.DOX_TASKS_TOKEN ??
    process.env.GH_TOKEN ??
    process.env.GITHUB_TOKEN ??
    undefined;
  const appCreds = options?.appCreds ?? envAppCreds();
  if (appCreds) {
    try {
      return await mintInstallationToken(appCreds, options?.fetchImpl ?? fetch);
    } catch (err) {
      // A transient mint failure (rate limit, revoked/suspended install, GitHub
      // 5xx) must NOT take Track offline when a PAT is configured — fall back to
      // it. With no PAT, return undefined (not throw) so callers no-op cleanly
      // and GitHub redelivers the webhook, rather than throwing → a 200 that
      // GitHub treats as delivered.
      console.warn(
        `[thally-track] GitHub App token mint failed, falling back to PAT: ${err instanceof Error ? err.message : String(err)}`,
      );
      return pat;
    }
  }
  return pat;
}

async function githubJson<T>(
  path: string,
  options?: GithubFetchOptions,
): Promise<T> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const token = await resolveGithubToken(options);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com${path}`, {
    headers,
  });
  if (!response.ok) {
    const hint =
      response.status === 404 || response.status === 403
        ? " (private repo or rate limit? set THALLY_GITHUB_TOKEN or connect a GitHub App)"
        : "";
    throw new Error(`GitHub API ${response.status} for ${path}${hint}`);
  }
  return (await response.json()) as T;
}

interface RawPull {
  number: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  base?: { ref?: string };
  head?: { ref?: string };
  merge_commit_sha?: string | null;
  merged_at?: string | null;
  user?: { login?: string } | null;
}

function toPullRequestInfo(raw: RawPull): PullRequestInfo {
  return {
    number: raw.number,
    title: raw.title ?? "",
    body: raw.body ?? "",
    htmlUrl: raw.html_url ?? "",
    baseRef: raw.base?.ref ?? "main",
    ...(raw.merge_commit_sha ? { mergeCommitSha: raw.merge_commit_sha } : {}),
    ...(raw.user?.login ? { author: raw.user.login } : {}),
    ...(raw.head?.ref ? { sourceRef: raw.head.ref } : {}),
    ...(raw.merged_at ? { mergedAt: raw.merged_at } : {}),
  };
}

/** Fetch a pull request's metadata. */
export async function fetchPullRequest(
  owner: string,
  repo: string,
  number: number,
  options?: GithubFetchOptions,
): Promise<PullRequestInfo> {
  const raw = await githubJson<RawPull>(
    `/repos/${owner}/${repo}/pulls/${number}`,
    options,
  );
  return toPullRequestInfo(raw);
}

/** Fetch a pull request's changed files with per-file patches (one page, up to 100). */
export async function fetchPullRequestFiles(
  owner: string,
  repo: string,
  number: number,
  options?: GithubFetchOptions,
): Promise<Array<PrFile>> {
  // Paginate: GitHub caps the files list at 100 per page. Without this, a PR
  // whose only tracked-path match sits past file 100 would look like it touches
  // no tracked paths and silently be dropped. Cap at 30 pages (3000 files) — a
  // larger PR is pathological and the extra round-trips aren't worth it.
  const perPage = 100;
  const maxPages = 30;
  const raw: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }> = [];
  for (let page = 1; page <= maxPages; page++) {
    const chunk = await githubJson<
      Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
      }>
    >(
      `/repos/${owner}/${repo}/pulls/${number}/files?per_page=${perPage}&page=${page}`,
      options,
    );
    raw.push(...chunk);
    if (chunk.length < perPage) break;
  }
  return raw.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    ...(f.patch ? { patch: f.patch } : {}),
  }));
}

/**
 * The most recent MERGED pull request into `base`, or null when there is none.
 * Used by `thally track test` / `sync_from_repo` to preview "the latest merge".
 */
export async function fetchLatestMergedPr(
  owner: string,
  repo: string,
  base: string,
  options?: GithubFetchOptions,
): Promise<PullRequestInfo | null> {
  const raw = await githubJson<Array<RawPull>>(
    `/repos/${owner}/${repo}/pulls?state=closed&base=${encodeURIComponent(base)}&sort=updated&direction=desc&per_page=30`,
    options,
  );
  // GitHub can't sort by merge time, and `sort=updated` ranks by last activity —
  // a PR merged days ago but commented today outranks one merged an hour ago. So
  // pick the most-recently-MERGED among the fetched page, not the first merged in
  // updated order.
  const merged = raw
    .filter((pr) => Boolean(pr.merged_at))
    .sort(
      (a, b) => Date.parse(b.merged_at ?? "") - Date.parse(a.merged_at ?? ""),
    )[0];
  return merged ? toPullRequestInfo(merged) : null;
}

