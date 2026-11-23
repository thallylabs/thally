# Release the public runtime and starter

The normal production path has one operator action. After runtime or starter
changes are merged, run **Full release** from the `thally` Actions page, or run:

```bash
npm run release:full
```

The workflow runs in two stages.

**Stage 1, `Sync · Promote · Merge record`, is the blocking stage.** It
resolves the current runtime `main`, synchronizes the standalone starter, and
creates, verifies, and merges the immutable release record. It is designed
to finish in about five minutes and ends with the record on `main`.

The starter synchronization and the record promotion overlap. The starter
workflow advances its `main` by fast-forward to the exact commit its CI
verified, so the commit is known as soon as the synchronization pull request
opens. The controller binds the record to that commit and prepares the record
pull request while starter CI is still running. Nothing merges early:

- The record merges only after its own CI passes **and** the selected starter
  commit is on starter `main`, which the starter allows only after its CI
  passes.
- The stage succeeds only after the starter synchronization run succeeds.
- A controller promotion that fails or is cancelled closes its record pull
  request and deletes its branch, so a record bound to a starter commit that
  never reached starter `main` cannot be merged by hand.

**Stage 2, `Publish · Promote to Cloud`, is the asynchronous tail.** It starts
when the record is merged, waits for the scaffold packages to be published and
verified through npm trusted publishing, then waits for the managed scaffold
promotion to complete. It takes roughly twenty minutes and changes no
repository. A failure in this stage fails the workflow run.

A failed phase stops the controller and leaves its workflow run visible for
diagnosis. Re-running the controller is safe; already-stable inputs are a
successful no-op.

### Recovering from a failed release

- **Stage 1 failed before the record merged.** Dispatch **Full release**
  again. The failed promotion closed its record pull request; the new run
  pushes the record branch again and opens a fresh pull request with a fresh
  CI run, even when the release id is the same because it is the same UTC day.
  An already-merged starter synchronization is detected and reused.
- **The record merged but stage 2 failed in npm or Cloud.** Dispatch **Full
  release** again rather than re-running only the failed job. It detects the
  merged record and restarts only the interrupted publication.
- **The record merged but its publish-time unit suite failed.** Nothing was
  attested, published to npm, or handed to Cloud. **Publish packages** runs
  the whole suite in parallel test shards beside packing, and its attestation,
  publication, and Cloud handoff jobs all require every shard to pass. Fix the
  cause with a normal pull request on `main`, then dispatch **Full release**
  again. That promotes a new record with the next patch versions; the
  versions named by the failed record are never published and are simply
  skipped.
- **The controller could not read GitHub while watching the starter.** It
  retries with backoff. If it still cannot tell whether the starter
  synchronization succeeded, it fails without cancelling the promotion, which
  merges only if the selected starter commit is on starter `main`. Check both
  runs, then dispatch **Full release** again.

### Pull-request CI

**CI** runs independent jobs side by side, and one gate job, `Test · Build`,
carries the required check and fails unless every other job succeeded:

- `Content · Release contracts` checks the release disposition, builds the
  workspace packages, validates authored content, and runs the workflow
  contract tests, for every pull request;
- four `Test` shards split the unit suite by recorded test time
  (`.github/scripts/test-shards.mjs`);
- `Test release-record consumers` runs the record subset described below;
- `Managed Worker build` builds and size-checks the managed Worker;
- `Windows · Starter updates` runs the starter updater tests with Windows
  line endings.

Each job that depends on the change computes the same plan itself (`full`,
`content`, or `record`; see `.github/scripts/plan-public-ci.mjs`) and skips
its remaining steps when the plan does not need them. A plan is chosen only
from the content of the two commits, so every job that succeeds agrees on
it. A pull request with no base commit (a manual dispatch) plans `full`. If
git cannot compare the commits in a job (missing objects, shallow history),
that job's plan step fails instead of choosing a plan, the required check
fails, and re-running the failed jobs recovers. A plan step that somehow
writes no plan runs everything.

Linux jobs restore installed dependencies from a cache keyed on the exact
lockfile. Only `Content · Release contracts` saves a missed entry, and not on
a record pull request. A pull request's cache cannot seed another pull
request, so **Warm CI dependency cache** seeds the shared entry from `main`
whenever the lockfile or the install action changes there. That includes
merging the change that introduces it and every merged release record. A
pull request whose CI runs before that warming run finishes pays a cold
install. Record pull requests always change the lockfile, so each of their
Linux jobs that installs pays a cold `npm ci`.

### Release-record pull requests use a lighter CI plan

A record pull request changes only package versions, exact pins between the
workspace packages, the lockfile entries for those packages, and the two
scaffold record files. CI selects its `record` plan only after proving that
from the content of the diff; changed paths alone never qualify. The proof
rebuilds the expected bytes of each file from the base commit and requires the
candidate to match exactly:

- only `create-thally-docs` and the publishable packages that depend on it are
  bumped, each by exactly one patch version, with exact pins on each other;
- the lockfile differs only in those workspace entries;
- the new record is the outgoing record with only its release id, commit and
  tree identifiers, archive URL, and manifest digest replaced, and the
  outgoing record is prepended to the retained list;
- every changed file is a regular, non-executable file.

The proof establishes the shape of the change. It does not check that the
commits named by the record exist or match the starter; the promotion workflow
and the publication gates do that.

The `record` plan skips the Windows job, the managed Worker build, and the
test shards. Instead, its own job runs a subset of the unit suite: the tests
of every workspace a promotion versions and of every workspace that depends
on one (`packages/create-thally-docs`, `packages/mcp`, `packages/cli`,
`packages/agent`). Those are the tests that read the record files, the bumped
manifests, or the packages built from them, so a record the suite would
reject fails the required check. A structural test fails if a test outside
those directories can reach the record files. The contracts job still
installs, checks the release disposition, builds the packages, validates
authored content, and runs the workflow contract tests. **Publish packages**
still runs the whole suite on the merged record commit, and attests and
publishes nothing unless every test shard passed.

Any other difference falls back to the full plan. That includes a lockfile
refresh that also rewrites a third-party entry, as happened in several past
promotions; such a release still completes, on the slower full plan.

### Deployment order for the starter fast-forward

The controller in this repository requires the starter's **Sync Thally
runtime** workflow to fast-forward. Merge the starter workflow change before
the controller change in this repository. If the order is reversed, the
starter squash-merges, the selected commit never reaches starter `main`, and
the release stops with an error naming the fast-forward requirement before any
record is merged. Dispatching **Full release** again then binds the merged
starter `main` and completes.

Before a candidate record PR is opened, the shared updater must upgrade the
outgoing stable scaffold and the oldest retained scaffold to the candidate.
The gate verifies framework and package parity, exact provenance, and owner
content preservation using immutable archives without executing their code.
The package verification job repeats this check before packing and attestation,
so manual recovery and directly reviewed record changes also fail before npm
publication when existing projects cannot upgrade safely.

The separate **Sync Thally runtime**, **Promote release**, and **Publish
packages** dispatches remain break-glass recovery tools.

## One-time coordinator setup

Create a GitHub App named `Thally Release Coordinator` and install it on the
repositories the release touches. Grant these repository permissions and
nothing else:

- Actions: read and write
- Contents: read and write
- Metadata: read-only
- Pull requests: read and write
- Issues: read and write (the release-record label only)

Generate one private key. Then configure the no-review `release-control`
environment in `thally` and `starter`, restricted to the `main` branch. Each
job mints a token narrowed to only the permissions it needs; the controller
cannot write source, and destination PR jobs cannot dispatch other workflows.
The branch restriction is the security boundary: workflow revisions on feature
branches cannot receive the App key. The workflow-dispatch click itself is the
release authorization.

```bash
export RELEASE_APP_CLIENT_ID='<github-app-client-id>'
export RELEASE_APP_KEY_FILE='/absolute/path/to/release-coordinator.private-key.pem'
export RELEASE_APP_ACTOR='thally-release-coordinator[bot]'

for repo in thally starter; do
  gh api --method PUT \
    "repos/thallylabs/$repo/environments/release-control" \
    --input - <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON

  if ! gh api \
    "repos/thallylabs/$repo/environments/release-control/deployment-branch-policies" \
    --jq '.branch_policies[] | select(.name == "main") | .id' | grep -q .; then
    gh api --method POST \
      "repos/thallylabs/$repo/environments/release-control/deployment-branch-policies" \
      -f name=main -f type=branch
  fi

  gh variable set RELEASE_COORDINATOR_CLIENT_ID \
    --repo "thallylabs/$repo" \
    --env release-control \
    --body "$RELEASE_APP_CLIENT_ID"

  gh secret set RELEASE_COORDINATOR_PRIVATE_KEY \
    --repo "thallylabs/$repo" \
    --env release-control \
    < "$RELEASE_APP_KEY_FILE"

  gh variable set RELEASE_COORDINATOR_ACTOR \
    --repo "thallylabs/$repo" \
    --env release-control \
    --body "$RELEASE_APP_ACTOR"
done
```

Keep npm trusted publishing bound to the existing `npm-production` environment.
Do not add npm or cross-repository PATs. The verified package workflow mints a
short-lived Actions-only token to hand the immutable release locator to the
managed scaffold promotion.
