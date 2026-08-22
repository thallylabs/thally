# Release the public runtime and starter

The normal production path has one operator action. After runtime or starter
changes are merged, run **Full release** from the `thally` Actions page, or run:

```bash
npm run release:full
```

The workflow resolves the current runtime `main`, synchronizes the standalone
starter, waits for its CI, merges the generated snapshot, creates and verifies
the immutable release record, publishes the three scaffold packages through
trusted publishing, and waits for Thally Cloud to promote the exact scaffold. A failed
phase stops the controller and leaves its pull request or workflow run visible
for diagnosis. Re-running the controller is safe; already-stable inputs are a
successful no-op.

The separate **Sync Thally runtime**, **Promote release**, **Publish packages**,
and Cloud promotion dispatches remain break-glass recovery tools.

When rolling out this automation itself, merge its `starter` and `thally-cloud`
changes before the `thally` controller change. That ensures the controller's
new inputs and release-id run correlation exist before the button is available.

## One-time coordinator setup

Create a GitHub App named `Thally Release Coordinator` in the `thallylabs`
organization and install it only on `thally`, `starter`, and `thally-cloud`.
Grant these repository permissions and nothing else:

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

Thally Cloud receives only an immutable locator from the verified npm workflow.
Its automatic path uses a separate no-review `scaffold-production` environment,
also restricted to `main`. Manual production recovery continues to use the
review-protected `production` environment.

```bash
gh api --method PUT \
  repos/thallylabs/thally-cloud/environments/scaffold-production \
  --input - <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON

if ! gh api \
  repos/thallylabs/thally-cloud/environments/scaffold-production/deployment-branch-policies \
  --jq '.branch_policies[] | select(.name == "main") | .id' | grep -q .; then
  gh api --method POST \
    repos/thallylabs/thally-cloud/environments/scaffold-production/deployment-branch-policies \
    -f name=main -f type=branch
fi

gh variable set RELEASE_COORDINATOR_ACTOR \
  --repo thallylabs/thally-cloud \
  --body "$RELEASE_APP_ACTOR"
```

Keep npm trusted publishing bound to the existing `npm-production` environment.
Do not add npm or cross-repository PATs. The verified package workflow mints a
short-lived Actions-only token to start the fixed Cloud workflow on `main`.
