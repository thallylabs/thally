# @thallylabs/agent-scan

A black-box scanner that measures how readable a public documentation site is to AI agents. It fetches a small, deterministic sample of a site over plain HTTP, applies the `thally-agent-scan` v1.0 methodology, and reports a 0–100 score, a letter grade, and the evidence behind every check.

It needs no account and no access to the site's source. Every site is scored by the same published rules, including sites built with Thally.

> This package is not yet published to npm. Run it from this repository (see [Usage](#usage)).

## What it checks

The methodology is frozen in [`src/methodology/methodology-v1.0.json`](src/methodology/methodology-v1.0.json). That file is the single source for check ids, categories, weights, pass rules, probe paths, limits and grade bands. The scorer reads its weights from it, and a test fails if the code and the file disagree.

| Category | Weight | Checks |
|---|---|---|
| Discovery | 20 | llms.txt, llms-full.txt, sitemap, agent or MCP manifest; AI-agent robots rules (reported, not scored) |
| Identity | 15 | self-referencing canonical, `<html lang>`, title and meta description, a modification date |
| Structure | 15 | a single `<h1>`, no skipped heading levels, valid typed JSON-LD |
| Retrieval | 30 | main content rendered without JavaScript, a Markdown or JSON alternate, status health |
| Trust | 10 | an identified owner, an edit or feedback path |
| Parity | 10 | the alternate's title matches the HTML, meta and JSON-LD descriptions agree |

Each check is binary or a pass rate across the sampled pages.

- A category score is the mean of its applicable checks.
- The site score is the weighted mean of applicable categories, rounded to an integer.
- A check that does not apply (for example, parity when no alternate exists) leaves the mean, and a category with no applicable checks leaves the weight sum.
- Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, otherwise F.

## Usage

Build once from the repository root, then run the CLI with Node 22 or later:

```sh
npm ci
npm run packages:build
node packages/agent-scan/dist/cli.js --help
```

### Scan one site

```sh
node packages/agent-scan/dist/cli.js scan https://docs.example.com/
node packages/agent-scan/dist/cli.js scan https://docs.example.com/ --json
```

The text output shows the score, grade, detected platform, and one line per check with its status, value, and first evidence URL. `--json` prints the full result as canonical JSON (keys sorted).

Exit codes: `0` scanned, `3` the site's status is `error` or `skipped`, `2` usage error, `1` unexpected failure.

### Scan many sites

```sh
node packages/agent-scan/dist/cli.js batch --input sites.csv --out results/ --concurrency 4
```

The input is a CSV with a `url` column, or a frame CSV from `frame` (rows with `decision=include` are scanned at `docs_root`). The output directory receives:

- `results.jsonl`: one canonical JSON result per site, appended as each site finishes.
- `results.csv`: one flattened row per site, with a value and a status column per check.
- `summary.json`: aggregates only. Every block is reported for all sites and again excluding Thally-hosted sites. Platform statistics include only high-confidence detections.

A batch is resumable. Rerunning the same command skips sites that already have a result and repairs a line cut off by a crash. `--retry-errors` re-scans sites whose result is `error` or `skipped`. One failing site never stops the batch.

Exit codes: `0` the batch finished, even if some sites have status `error` or `skipped`; `1` at least one site failed unexpectedly (it is retried on the next run); `2` usage error, including a malformed input CSV (the message names the line).

### Build a sample frame

```sh
GITHUB_TOKEN=... node packages/agent-scan/dist/cli.js frame --out frame/sample.csv --limit 1000
```

This lists the most-starred public GitHub repositories, resolves each homepage to a documentation root, and records an inclusion decision and reason per repository in `sample.csv`, with query counts in `frame-meta.json`. `GITHUB_TOKEN` is optional; it raises the search rate limit and is sent only to the GitHub API. It is never printed or captured.

Docs roots are tried in this order: a `docs.` subdomain of the registrable domain (resolved with the Public Suffix List), a `/docs/` path, the homepage itself when it looks like documentation, then a same-site homepage link labelled as documentation (such as "Docs" or "Documentation"). Repositories without a homepage, hosted on github.com, unreachable, or sharing a docs root with a higher-ranked repository are excluded with a reason.

### Library

```ts
import { scanSite, stableStringify } from '@thallylabs/agent-scan'

const result = await scanSite('https://docs.example.com/')
console.log(result.score, result.grade)
console.log(stableStringify(result))
```

`scanSite` never throws for network, HTTP or content failures. Those produce `status: 'error'` or `'skipped'` with a stable `reason` code such as `dns`, `timeout`, `http_status`, `not_html`, `body_too_large` or `robots_disallowed`.

## Politeness

- User agent: `ThallyAgentScan/1.0 (+https://thally.io/agent-readiness-methodology)`.
- robots.txt is honoured for the `ThallyAgentScan` product token (RFC 9309). A site that disallows the docs root is skipped. A robots.txt that times out or returns a 5xx status means the site is skipped (`robots_unreachable`). A robots.txt request that fails to connect (`connection`, `dns` or `tls`) means the site could not be reached, and its status is `error` with that reason.
- At most one request per second per host, shared across concurrent sites, and at most 25 requests per site, counting retries and redirect hops.
- A 10-second timeout per attempt and up to 2 retries for timeouts, connection failures, and status 429, 500, 502, 503 and 504. A response whose compressed body cannot be decoded is reported as `decode` and is not retried.
- GET requests only, with no cookies, logins or form submissions.
- Bodies are capped at 5 MB after decompression, and only the first 2 KB of llms-full.txt is read.

## Sampling

The scanner reads the site's sitemap (robots.txt `Sitemap:` lines first, then `/sitemap.xml` and `/sitemap-index.xml`, then `sitemap.xml` under the docs root; at most three are fetched), keeps URLs under the docs root that robots.txt allows, sorts them by code unit, and takes every k-th URL to get 10 pages, plus the docs root. Without a sitemap it takes the first 10 same-site links breadth-first from the docs root. The same inputs always give the same sample.

## Captures and replay

`--captures <dir>` records every request made for a site: URL, Accept header, status, response headers (with `set-cookie` values redacted) and a SHA-256 of the body. No other request headers, timings or IP addresses are stored. Raw bodies are kept for a deterministic 10% of sites by default; use `--capture-bodies all|none|<percent>` to change that. `--capture-bodies` requires `--captures`.

A capture with bodies can be replayed offline:

```sh
node packages/agent-scan/dist/cli.js scan --replay <dir>/<site-key> --json
```

With the same scanner version, replay produces a byte-identical result. A capture records whether it was made with `--allow-private-network`, and replay applies the same setting. A capture without bodies supports auditing only. Note that the llms-full.txt body hash covers only the prefix that was read.

## Network safety

Every requested URL and redirect hop must be `http` or `https`, without credentials, on port 80 or 443. DNS answers are checked at connect time, and only public unicast addresses are allowed, so a hostname that resolves to a loopback or private address is refused. `--allow-private-network` lifts these rules for local testing only.

## Limitations

- No JavaScript is executed. Feedback widgets and content rendered only on the client are not seen, so some correction-path and server-rendering results are false negatives by design.
- MCP and agent manifest discovery is not standardized. v1.0 probes `/.well-known/mcp.json`, `/.well-known/mcp/server-card.json` and `/.well-known/agent-card.json`, plus MCP URLs in llms.txt and `rel="mcp"` links. An MCP URL from llms.txt counts only when a GET suggests an endpoint (status 400, 405 or 406, a successful JSON or event-stream response, or a successful non-HTML response at a path ending in `mcp`); a documentation page about MCP does not count. That request shares the three well-known probe slots.
- The Markdown or JSON alternate is probed on one sample page, so it is a site-level check. The variants are a declared `rel="alternate"` link, `<url>.md`, plain content negotiation on the page URL (`Accept: text/markdown, application/json;q=0.9`), and `<url>?format=json`. A site-wide link to llms.txt, RSS, Atom and JSON feeds, and declared alternates on another host do not count; alternates on another host are not fetched.
- JSON-LD descriptions and dates are read from the page's own node (an article or web page type, preferring the node whose `url` or `@id` is the page URL), not from a site-wide `WebSite` or `Organization` node, unless the page has no page-level node.
- Bot-protection pages served with status 200 look like thin pages.
- Platform detection is descriptive. `thallyHosted` means the site runs the Thally engine and does not distinguish managed from self-hosted sites.
- The methodology is a black-box subset of Thally's in-product readiness scoring and uses its own version number.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | unset | Optional. Authenticates `frame` requests to the GitHub search API. |

## Development

Tests live in `src/__tests__` and run with the repository's `npm test`. They use synthetic fixtures served by an injected transport or a local HTTP server on `127.0.0.1`. No test touches the internet.

## License

MIT. The methodology file is published under CC BY 4.0.
