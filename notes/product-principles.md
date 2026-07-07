# Dox Product Principles — "What Would Apple Do"

> Internal strategy note. Not published to the docs site (lives outside `src/content/`).
> Reference this when making product and architecture decisions.

## The wedge (the one thing we win)

**Dox is the documentation platform for the age of AI agents.**

Mintlify is a human docs tool that bolted on AI. We are agent-native. Crucially,
Mintlify cannot fully copy this without cannibalizing their hosted-tracking,
lock-in business model. That asymmetry is our defensible position.

Do **not** chase Mintlify feature-for-feature. Pick the agent wedge and make it
10x better, not 10% better across the board.

## The three Apple principles we hold ourselves to

1. **Pick one wedge and make it 10x better.** (iPod = "1,000 songs in your pocket".)
   Our wedge is agent-native docs. Everything ladders up to it.
2. **Obsess over the first 60 seconds.** The unboxing / first-run experience *is*
   the product. `npx create-dox` → live, agent-ready docs with zero config.
3. **Make the right thing the default.** You should never have to *configure*
   quality, privacy, performance, accessibility, or agent-readiness. It's just there.

Supporting tenets:
- **Cohesion is the product.** One mental model, one `dox` toolchain — not a pile of packages.
- **Privacy as a headline, not a footnote.** Self-hosted analytics: your traffic data
  never leaves your infra. ("What happens on your docs stays on your docs.")
- **The framework is an implementation detail.** Users author content + config; the
  platform owns rendering. Don't leak the runtime into their face.
- **Perceived performance and craft are non-negotiable.** Nothing janky ships.

## Next bets (priority order)

1. **Agent Readiness Score** — a single 0–100 score in the dashboard (like Battery
   Health / Privacy Report) showing how well the docs serve agents, with one-tap
   fixes. Makes the invisible agent layer visible, improvable, brag-worthy. Uniquely
   ours; builds on the analytics + classifier + lint already shipped.
2. **Zero-config OOBE + `dox deploy`** — fix the first 60 seconds so the wedge is
   actually reachable. No required env vars to get a working, agent-ready site.
3. **Performance & craft pass** — instant/prefetch navigation, real search,
   zero layout shift, Core Web Vitals budget enforced in CI.
4. **Privacy-first positioning** — "own your data + agent-native" as the headline promise.

## Decision rule

When choosing what to build or how to build it, ask in order:
1. Does it strengthen the **agent-native wedge** or just match Mintlify?
2. Does it improve the **first 60 seconds**?
3. Can we make it a **default** instead of a setting?
4. Does it add **cohesion** or fragmentation?

If a feature doesn't serve 1–3, it's probably not next.

## Architecture north star (see stack audit)

The product is **content + config as the surface, framework as hidden runtime.**
The structured representation of a doc is the **single source of truth**; HTML,
JSON, JSON-LD, Markdown, and embeddings are all *projections* of it. We never
parse content twice with different code paths.

This is also why config is framework-agnostic: the site URL is `DOX_SITE_URL`
(not `NEXT_PUBLIC_SITE_URL`), the toolchain is `dox`, not `next`. A user should
be able to use Dox for a year and never learn what renders it.

## AI key strategy — "aha first, then bring your own"

Principle 3 ("make the right thing the default") applied to AI chat: a brand-new
site should be able to *answer questions in the first 60 seconds* without anyone
pasting an API key. But we can't fund unlimited inference for everyone forever.
So chat runs in two tiers, resolved automatically (see `src/lib/ai/chat-access.ts`):

| Tier | Key source | Limits | Who it's for |
| --- | --- | --- | --- |
| **Owner** | `ANTHROPIC_API_KEY` | Generous (20 req/min default, no global cap) | Production sites paying for their own usage |
| **Trial** | `DOX_TRIAL_ANTHROPIC_KEY` (shared) | Strict per-IP **and** a global daily ceiling | The out-of-the-box aha moment |

Resolution precedence: owner key → trial key → chat disabled (helpful 503).
The active tier is surfaced on responses via the `x-dox-ai-tier` header so the
widget/dashboard can nudge: *"You're on the Dox trial key — add your own key to
remove limits."*

**How the trial key is protected (defense in depth):**
1. Per-IP sliding windows (per-minute + per-day).
2. A single **global daily ceiling** across all IPs for the shared key
   (`DOX_TRIAL_DAILY_LIMIT`), so one busy deployment can't drain it.
3. A **hard spend cap** configured at the Anthropic account level on the trial
   key itself — the real backstop, since in-memory counters are per-instance on
   serverless and are a soft limit only.
4. Cheapest capable model (`claude-haiku-*`) + retrieval (small context budget),
   so trial answers cost cents, not dollars.

**Hosted vs self-hosted:**
- *Hosted Dox*: we inject `DOX_TRIAL_ANTHROPIC_KEY` for every site; the trial is
  metered per workspace and converts to "add your own key or upgrade."
- *Self-hosted*: owners just set `ANTHROPIC_API_KEY`. They can optionally set
  their own trial key if they want a shared low-limit fallback. No Dox dependency.

**Durability note:** robust global metering (and per-workspace trial quotas)
needs the durable store on the roadmap (libSQL/Turso, issue #21). The current
in-memory limiter is the MVP; the Anthropic-account spend cap covers the gap.

## Pricing model — don't copy Mintlify's $300/site

Mintlify charges ~$300/mo **per site**, bundling hosting. That price is anchored
to *human* docs seats and hosted lock-in. Our wedge is different, so our pricing
should reflect a different unit of value.

**Why not flat $300/site:**
- It taxes having *more* docs sites, which punishes exactly the teams we want
  (many products, many docs). Per-site pricing is a Mintlify-shaped constraint.
- We don't *need* to own hosting — "framework is an implementation detail" means
  a site can deploy to the user's own Vercel/Cloudflare/Netlify for ~free. We
  shouldn't force them onto our hosting just to extract margin.
- Our defensible value isn't "we host your HTML." It's the **agent layer**:
  retrieval, the agent-readiness score, agent analytics, MCP, structured
  projections. Price *that*.

**Recommended model — open core + agent-metered:**

1. **Free / Open (self-host):** the `dox` toolchain, agent endpoints, JSON-LD,
   client search, local-embedding chat with the trial key, self-hosted analytics.
   This is the wedge; it should be free and ungated to win developer love and
   distribution. Mintlify can't match this without hurting their hosted model.
2. **Pro — ~$0 base, usage-metered on the agent layer** (the part that costs us):
   hosted AI chat beyond the trial (or bring-your-own key for free), hosted
   embeddings, retained agent analytics history, scheduled agent-readiness
   reports. Price on *agent value delivered* (e.g. resolved agent queries /
   retained analytics months), not per static page or per human seat.
3. **Team/Business — flat per-workspace** (not per-site): SSO, roles, private
   docs, multiple sites under one bill, support SLA. A team with 8 docs sites
   pays once, not 8×$300. This is where we directly undercut Mintlify's per-site
   tax for multi-product orgs.
4. **Enterprise:** self-hosted control plane, audit, data residency, custom
   model routing — sold on "your agent + human traffic data never leaves your
   infra," which their hosted model structurally can't promise.

**Positioning line:** *"Mintlify charges per site to host your docs. Dox is free
to host anywhere, and you pay only for the agent intelligence you actually use."*

Net: free where Mintlify gates (hosting/sites), paid where we add unique,
ongoing cost+value (the agent layer). This aligns price with our wedge and
avoids importing a constraint built for human-docs economics.
