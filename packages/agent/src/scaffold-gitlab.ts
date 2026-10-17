/**
 * GitLab CI templates for Thally Track and the docs agent.
 *
 * GitLab has no `repository_dispatch`, so product projects start the docs
 * project's pipeline through a pipeline trigger token, passing the task as
 * pipeline variables (`THALLY_EVENT`, `INSTRUCTION`, `FROM_PR`, ...). The
 * receiver job reads those variables only as quoted environment values and
 * never interpolates them into YAML or re-parses them as shell, mirroring the
 * script-injection hardening of the GitHub Actions receiver.
 *
 * The GitHub Actions receiver is not generated from this module: its bytes
 * are a published contract (`thally-track/v4`) checked against the committed
 * workflow, so the GitLab variant is a separate template with the same
 * contract marker.
 */

import {
  DOCS_PREVIEW_LABEL,
  TRACK_OWNED_BRANCH_PREFIXES,
  buildTrackInstruction,
  type RepositoryRef,
  type TrackedRepoConfig,
} from "@thallylabs/mcp/track";
import { DEFAULT_AGENT_MODEL } from "./model.js";

/** Contract marker shared with the GitHub Actions receiver. */
const CONTRACT = "thally-track/v4";

/** Where `thally agent init --provider gitlab` writes the receiver. */
export const DOCS_AGENT_GITLAB_PIPELINE_PATH = ".gitlab/ci/thally-agent.gitlab-ci.yml";

/** Committer identity for agent commits made in GitLab pipelines. */
export const GITLAB_AGENT_COMMITTER_EMAIL = "thally-agent@noreply.thally.io";

/** Options for {@link buildDocsAgentGitlabPipeline}. */
export interface DocsAgentGitlabPipelineOptions {
  /** Repository-relative directory containing docs.json for monorepo sites. */
  docsRootDir?: string | null;
}

function validateDocsRootDir(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return undefined;
  if (trimmed.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("The docs root must be a repository-relative directory.");
  }
  return trimmed;
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? `${pad}${line}` : line))
    .join("\n");
}

/**
 * Receiver shell. Every pipeline variable is optional and read through
 * `${NAME:-}` so `set -u` holds, and every value is used quoted. Possibly
 * empty arrays expand through `${ARR[@]+"${ARR[@]}"}`, which older bash
 * releases require under `set -u`.
 */
const GITLAB_RECEIVER_SCRIPT = `INSTRUCTION="\${INSTRUCTION:-}"
FROM_PR="\${FROM_PR:-}"
TRACK_CONTEXT="\${TRACK_CONTEXT:-}"
REQUESTER="\${REQUESTER:-}"
THALLY_PR_GRANT="\${THALLY_PR_GRANT:-}"
THALLY_PR_BRANCH="\${THALLY_PR_BRANCH:-}"
THALLY_PR_BROKER_URL="\${THALLY_PR_BROKER_URL:-https://app.thally.io/api/gitlab/readiness-pr}"
export THALLY_AGENT_MODEL="\${THALLY_AGENT_MODEL:-${DEFAULT_AGENT_MODEL}}"
# A project access token (api + write_repository) reads tracked merge
# requests, pushes the agent branch, and opens the merge request.
export THALLY_GITLAB_TOKEN="\${THALLY_AGENT_TOKEN:-}"
export THALLY_GIT_HOSTS="\${THALLY_GIT_HOSTS:-\${CI_SERVER_HOST:-gitlab.com}=gitlab}"
if [ -z "$INSTRUCTION" ]; then
  echo "No INSTRUCTION variable was provided; nothing to do."
  exit 0
fi
# GitLab checks out a detached commit; the agent needs a named base branch.
git checkout -B "$CI_COMMIT_REF_NAME"
run_thally() {
  if [ -x node_modules/.bin/thally ]; then
    node_modules/.bin/thally "$@"
    return
  fi
  npm run packages:build
  node packages/cli/dist/index.js "$@"
}
REQUESTER_ARGS=()
if [ -n "$REQUESTER" ]; then
  REQUESTER_ARGS=(--requester "$REQUESTER")
fi
OUTPUT_ARGS=(--pr)
if [ -n "$THALLY_PR_GRANT" ]; then
  # A readiness repair leaves its validated changes staged; Cloud opens the
  # merge request after GitLab ID-token authentication.
  OUTPUT_ARGS=()
fi
if [ -n "$TRACK_CONTEXT" ]; then
  CONTEXT_FILE="$(mktemp -d)/thally-track-context.md"
  printf '%s' "$TRACK_CONTEXT" > "$CONTEXT_FILE"
  run_thally agent "$INSTRUCTION" --from-pr "$FROM_PR" --context-file "$CONTEXT_FILE" \${REQUESTER_ARGS[@]+"\${REQUESTER_ARGS[@]}"} \${OUTPUT_ARGS[@]+"\${OUTPUT_ARGS[@]}"}
elif [ -n "$FROM_PR" ]; then
  run_thally agent "$INSTRUCTION" --from-pr "$FROM_PR" \${REQUESTER_ARGS[@]+"\${REQUESTER_ARGS[@]}"} \${OUTPUT_ARGS[@]+"\${OUTPUT_ARGS[@]}"}
else
  run_thally agent "$INSTRUCTION" \${REQUESTER_ARGS[@]+"\${REQUESTER_ARGS[@]}"} \${OUTPUT_ARGS[@]+"\${OUTPUT_ARGS[@]}"}
fi
if [ -n "$THALLY_PR_GRANT" ]; then
  GENERATED_BRANCH="$(git branch --show-current)"
  if [[ "$GENERATED_BRANCH" != thally/agent-* ]]; then
    echo "No documentation changes were needed."
    exit 0
  fi
  if [[ ! "$THALLY_PR_BRANCH" =~ ^thally/agent-readiness-[a-f0-9]{16}$ ]]; then
    echo "The readiness branch grant is invalid." >&2
    exit 1
  fi
  node -e 'const url = new URL(process.env.THALLY_PR_BROKER_URL); const isProduction = url.origin === "https://app.thally.io"; const isPreview = /^deploy-preview-[0-9]+--thally-cloud\\.netlify\\.app$/.test(url.hostname); if (url.pathname !== "/api/gitlab/readiness-pr" || (!isProduction && !isPreview)) process.exit(1)'
  git branch -m "$THALLY_PR_BRANCH"
  git commit -m "docs: improve Thally Agent Readiness"
  # The token reaches git through a credential helper reading the environment,
  # never through argv or .git/config.
  git -c credential.helper= -c 'credential.helper=!f() { echo username=oauth2; echo "password=$THALLY_GITLAB_TOKEN"; }; f' \\
    push "$CI_SERVER_URL/$CI_PROJECT_PATH.git" "HEAD:refs/heads/$THALLY_PR_BRANCH"
  REQUEST_FILE="$(mktemp)"
  RESPONSE_FILE="$(mktemp)"
  node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ grant: process.env.THALLY_PR_GRANT }))' "$REQUEST_FILE"
  curl --silent --show-error --fail-with-body \\
    --output "$RESPONSE_FILE" \\
    -H "Authorization: Bearer $THALLY_OIDC_TOKEN" \\
    -H "Content-Type: application/json" \\
    --data-binary "@$REQUEST_FILE" \\
    "$THALLY_PR_BROKER_URL"
  node -e 'const body = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); if (typeof body.merge_request_url !== "string" && typeof body.pull_request_url !== "string") process.exit(1); process.stdout.write("Merge request: " + (body.merge_request_url ?? body.pull_request_url) + "\\n")' "$RESPONSE_FILE"
fi`;

const GITLAB_DRIFT_SCRIPT = `if [ -x node_modules/.bin/thally ]; then
  node_modules/.bin/thally check --drift --ci
else
  npm run packages:build
  node packages/cli/dist/index.js check --drift --ci
fi`;

/**
 * Build the docs-project receiver: a `thally-document` job started by a
 * pipeline trigger, the pipelines API, or a manual "Run pipeline" with an
 * `INSTRUCTION` variable, plus a scheduled drift sweep.
 */
export function buildDocsAgentGitlabPipeline(options: DocsAgentGitlabPipelineOptions = {}): string {
  const docsRootDir = validateDocsRootDir(options.docsRootDir);
  const cdLine = docsRootDir ? `\n    - cd ${JSON.stringify(docsRootDir)}` : "";
  return `# Contract: ${CONTRACT} (gitlab)
# Thally docs agent for GitLab CI. Include it from .gitlab-ci.yml:
#
#   include:
#     - local: ${DOCS_AGENT_GITLAB_PIPELINE_PATH}
#
# Settings > CI/CD > Variables (masked, protected as appropriate):
#   ANTHROPIC_API_KEY    Anthropic API key for the docs agent.
#   THALLY_AGENT_TOKEN   Project access token with api + write_repository.
#   THALLY_AGENT_MODEL   Optional model override.
# Settings > CI/CD > Pipeline trigger tokens: create one and store it in each
# product project as THALLY_DISPATCH_TOKEN (see "thally track setup").
# Jobs use the "test" stage; declare it if your pipeline sets custom stages.

.thally-node:
  image: node:20
  variables:
    GIT_DEPTH: "0"
  before_script:${cdLine}
    - npm ci
    - git config user.name "thally-agent"
    - git config user.email "${GITLAB_AGENT_COMMITTER_EMAIL}"

thally-document:
  extends: .thally-node
  stage: test
  rules:
    - if: '($CI_PIPELINE_SOURCE == "trigger" || $CI_PIPELINE_SOURCE == "pipeline" || $CI_PIPELINE_SOURCE == "api") && ($THALLY_EVENT == "thally-document" || $THALLY_EVENT == "thally-readiness")'
    - if: '$CI_PIPELINE_SOURCE == "web" && $INSTRUCTION'
  id_tokens:
    THALLY_OIDC_TOKEN:
      aud: thally-readiness-pr
  script:
    - |
${indent(GITLAB_RECEIVER_SCRIPT, 6)}

thally-drift-sweep:
  extends: .thally-node
  stage: test
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule" && $THALLY_DRIFT_SWEEP == "true"'
  script:
    - |
${indent(GITLAB_DRIFT_SCRIPT, 6)}
`;
}

/** Generic root receiver written by `thally agent init --provider gitlab`. */
export const DOCS_AGENT_GITLAB_PIPELINE = buildDocsAgentGitlabPipeline();

/** Minimal `.gitlab-ci.yml` for projects that have none yet. */
export const GITLAB_CI_INCLUDE_FILE = `# Thally docs agent — see ${DOCS_AGENT_GITLAB_PIPELINE_PATH}.
include:
  - local: ${DOCS_AGENT_GITLAB_PIPELINE_PATH}
`;

const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/;

/** Escape a value for a double-quoted bash string. */
function bashDq(value: string): string {
  return value.replace(/([\\"$`])/g, "\\$1");
}

/** Escape a value for an RE2 literal inside a `/.../` rules regex. */
function regexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Track path globs use `**` across directories. GitLab's `changes:` uses
 * fnmatch, where a trailing `**` only spans one level, so `src/**` becomes
 * `src/**\/*`.
 */
function gitlabChangesGlob(glob: string): string {
  const normalized = glob.replace(/^\.\//, "");
  return normalized.endsWith("/**") ? `${normalized}/*` : normalized;
}

function changesBlock(paths: Array<string> | undefined): string {
  if (!paths?.length) return "";
  return `\n      changes:\n${paths.map((p) => `        - ${JSON.stringify(gitlabChangesGlob(p))}`).join("\n")}`;
}

/**
 * Product-project sender jobs for Thally Track on GitLab CI.
 *
 * - `thally-track-preview` runs in merge request pipelines for open merge
 *   requests labelled `docs-preview` (draft docs before merge).
 * - `thally-track-merged` runs on pushes to the tracked branch. GitLab has no
 *   post-merge merge-request event, so it sends the merge commit URL and the
 *   docs receiver resolves the merge request (and applies the Track-owned
 *   branch loop guard) from it.
 *
 * Instruction prose comes from {@link buildTrackInstruction}, escaped for the
 * double-quoted bash context. Values reach curl with `--form-string`, so a
 * leading `@` or `<` is never read as a file.
 */
export function trackSenderGitlabJobs(docsRef: RepositoryRef, repo: TrackedRepoConfig): string {
  const branch = repo.branch && SAFE_BRANCH.test(repo.branch) ? repo.branch : "main";
  const gitlabRepo: TrackedRepoConfig = { ...repo, provider: "gitlab" };
  const NUMBER_TOKEN = "__THALLY_MR_IID__";
  const SHA_TOKEN = "__THALLY_COMMIT_SHA__";
  const previewInstruction = bashDq(
    buildTrackInstruction(gitlabRepo, { number: NUMBER_TOKEN as unknown as number }, { preview: true }),
  ).replace(NUMBER_TOKEN, "${CI_MERGE_REQUEST_IID}");
  const mergedInstruction = bashDq(buildTrackInstruction(gitlabRepo, { ref: SHA_TOKEN })).replace(
    SHA_TOKEN,
    "${CI_COMMIT_SHORT_SHA}",
  );
  const ownedBranches = TRACK_OWNED_BRANCH_PREFIXES.map(regexLiteral).join("|");
  const triggerUrl = `${docsRef.apiBaseUrl}/projects/${encodeURIComponent(docsRef.fullPath)}/trigger/pipeline`;
  // The URL is baked into a double-quoted shell string: allow URL-safe characters only.
  if (!/^https?:\/\/[A-Za-z0-9.:/%_-]+$/.test(triggerUrl)) {
    throw new Error(`Unsupported docs project API URL: ${triggerUrl}`);
  }
  const changes = changesBlock(repo.paths);
  return `# Thally Track sender for ${repo.owner}/${repo.repo} — add to this project's .gitlab-ci.yml.
# Settings > CI/CD > Variables: THALLY_DISPATCH_TOKEN (masked) = a pipeline
# trigger token from the docs project ${docsRef.fullPath}.

.thally-track-dispatch:
  stage: .post
  image:
    name: curlimages/curl:latest
    entrypoint: [""]
  variables:
    GIT_STRATEGY: none
  script:
    - |
      curl --silent --show-error --fail-with-body -X POST \\
        --form-string "token=$THALLY_DISPATCH_TOKEN" \\
        --form-string "ref=\${THALLY_DOCS_REF:-main}" \\
        --form-string "variables[THALLY_EVENT]=thally-document" \\
        --form-string "variables[INSTRUCTION]=$INSTRUCTION" \\
        --form-string "variables[FROM_PR]=$THALLY_FROM_PR" \\
        --form-string "variables[REQUESTER]=$GITLAB_USER_LOGIN" \\
        --form-string "variables[PREVIEW]=$PREVIEW" \\
        "${triggerUrl}"

thally-track-preview:
  extends: .thally-track-dispatch
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "${branch}" && $CI_MERGE_REQUEST_LABELS =~ /(^|,)${regexLiteral(DOCS_PREVIEW_LABEL)}(,|$)/ && $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME !~ /^(${ownedBranches})/'${changes}
  before_script:
    - |
      INSTRUCTION="${previewInstruction}"
      THALLY_FROM_PR="$CI_MERGE_REQUEST_PROJECT_URL/-/merge_requests/$CI_MERGE_REQUEST_IID"
      PREVIEW=true

thally-track-merged:
  extends: .thally-track-dispatch
  rules:
    - if: '$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "${branch}"'${changes}
  before_script:
    - |
      INSTRUCTION="${mergedInstruction}"
      THALLY_FROM_PR="$CI_PROJECT_URL/-/commit/$CI_COMMIT_SHA"
      PREVIEW=false
`;
}
