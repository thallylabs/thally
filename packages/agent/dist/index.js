// src/run.ts
import { execFileSync as execFileSync2 } from "child_process";

// src/git.ts
import { execFileSync } from "child_process";
function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function gitTry(cwd, args) {
  try {
    return { ok: true, out: git(cwd, args) };
  } catch {
    return { ok: false, out: "" };
  }
}
function assertCleanGitRepo(cwd) {
  if (!gitTry(cwd, ["rev-parse", "--is-inside-work-tree"]).ok) {
    throw new Error("`dox agent` needs a git repository to sandbox its edits \u2014 none found here.");
  }
  if (git(cwd, ["status", "--porcelain"])) {
    throw new Error("Working tree is not clean. Commit or stash your changes before running `dox agent`.");
  }
}
function currentBranch(cwd) {
  return git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
}
function createBranch(cwd, name) {
  git(cwd, ["checkout", "-b", name]);
}
function checkoutBranch(cwd, name) {
  git(cwd, ["checkout", name]);
}
function deleteBranch(cwd, name) {
  gitTry(cwd, ["branch", "-D", name]);
}
function stagedDiff(cwd) {
  git(cwd, ["add", "-A"]);
  return execFileSync("git", ["diff", "--cached"], { cwd, encoding: "utf8" });
}
function hardReset(cwd) {
  gitTry(cwd, ["reset", "--hard", "HEAD"]);
  gitTry(cwd, ["clean", "-fd"]);
}
function commitAll(cwd, message) {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-m", message]);
}
function push(cwd, branch) {
  git(cwd, ["push", "-u", "origin", branch]);
}
function hasChanges(cwd) {
  return git(cwd, ["status", "--porcelain"]).length > 0;
}

// src/tools.ts
import { zodToJsonSchema } from "zod-to-json-schema";
import { tools as mcpTools, getTool } from "@doxlabs/mcp/tools";
var AGENT_TOOL_NAMES = /* @__PURE__ */ new Set([
  "list_pages",
  "read_page",
  "search_docs",
  "get_context",
  "add_page",
  "update_page",
  "add_tab"
]);
function buildToolBridge(projectDir) {
  const selected = mcpTools.filter((tool) => AGENT_TOOL_NAMES.has(tool.name));
  const claudeTools = selected.map((tool) => {
    const schema = zodToJsonSchema(tool.schema, {
      $refStrategy: "none",
      target: "jsonSchema7"
    });
    delete schema.$schema;
    const props = schema.properties;
    if (props) delete props.projectDir;
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((r) => r !== "projectDir");
    }
    return { name: tool.name, description: tool.description, input_schema: schema };
  });
  const dispatch = async (name, input) => {
    const tool = getTool(name);
    if (!tool || !AGENT_TOOL_NAMES.has(name)) {
      return `Error: tool "${name}" is not available to the docs agent.`;
    }
    return tool.handler({ ...input, projectDir });
  };
  return { claudeTools, dispatch };
}

// src/validate.ts
import { spawnSync } from "child_process";
import { createRequire } from "module";
var require2 = createRequire(import.meta.url);
function resolveCheckBin() {
  try {
    return require2.resolve("create-dox");
  } catch {
    return require2.resolve("create-dox/dist/index.js");
  }
}
function runDocsCheck(projectDir) {
  const bin = resolveCheckBin();
  const res = spawnSync("node", [bin, "check", "--ci", projectDir], {
    encoding: "utf8",
    cwd: projectDir
  });
  const out = `${res.stdout ?? ""}
${res.stderr ?? ""}`;
  const errors = [];
  const warnings = [];
  for (const line of out.split("\n")) {
    const match = line.match(/^::(error|warning)\s+(.*?)::(.*)$/);
    if (!match) continue;
    const [, severity, loc, message] = match;
    const label = loc ? `${message.trim()} [${loc}]` : message.trim();
    if (severity === "error") errors.push(label);
    else warnings.push(label);
  }
  return { ok: errors.length === 0, errors, warnings };
}

// src/agent.ts
async function runAgentLoop(input) {
  const messages = [{ role: "user", content: input.userPrompt }];
  let steps = 0;
  let summary = "";
  while (steps < input.maxSteps) {
    steps++;
    const res = await input.client.messages.create({
      model: input.model,
      max_tokens: 4096,
      system: input.system,
      tools: input.tools,
      messages
    });
    messages.push({ role: "assistant", content: res.content });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) summary = text;
    const toolUses = res.content.filter(
      (b) => b.type === "tool_use"
    );
    if (toolUses.length === 0 || res.stop_reason !== "tool_use") {
      return { summary, steps };
    }
    const results = [];
    for (const use of toolUses) {
      input.onEvent?.(`${use.name} ${JSON.stringify(use.input).slice(0, 100)}`);
      let content;
      let isError = false;
      try {
        content = await input.dispatch(use.name, use.input);
      } catch (err) {
        content = `Error: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content, is_error: isError });
    }
    messages.push({ role: "user", content: results });
  }
  return { summary: summary || "Reached the step limit before finishing.", steps };
}

// src/config.ts
import fs from "fs";
import path from "path";
function loadAgentsGuidance(projectDir) {
  for (const name of ["AGENTS.md", ".github/AGENTS.md"]) {
    const filePath = path.join(projectDir, name);
    try {
      if (fs.existsSync(filePath)) return fs.readFileSync(filePath, "utf8").slice(0, 8e3);
    } catch {
    }
  }
  return "";
}

// src/prompt.ts
function buildSystemPrompt(agentsGuidance) {
  const base = [
    "You are the Dox documentation agent. You maintain a documentation site written in MDX and",
    "organized by a docs.json navigation file. Given a task, make the smallest correct set of",
    "documentation edits and then stop.",
    "",
    "How to work:",
    "- Explore first. Use list_pages, search_docs, and read_page to learn the existing structure,",
    "  voice, and MDX components before writing anything.",
    "- Prefer editing an existing page (update_page) over creating a new one. Use add_page only when",
    "  the topic genuinely has no home; it registers the page in navigation for you. Use add_tab only",
    "  for a whole new section.",
    "- Match the surrounding style. Keep edits minimal and scoped to the task. Never invent product",
    "  behavior \u2014 document only what the task and its context support.",
    "- When the documentation is written, STOP and reply with a short summary of what you changed and",
    "  why. Do not keep calling tools once the work is done \u2014 `dox check` runs automatically afterward,",
    "  and you will get a chance to fix anything it flags."
  ];
  if (agentsGuidance) {
    base.push("", "Project-specific guidance (AGENTS.md) \u2014 follow it exactly:", agentsGuidance);
  }
  return base.join("\n");
}
function buildUserPrompt(task) {
  const parts = [`Task: ${task.instruction}`];
  if (task.requester) parts.push(`Requested by: ${task.requester}`);
  if (task.context) parts.push("", "Context to document:", task.context);
  return parts.join("\n");
}
function buildRepairPrompt(errors) {
  return [
    "Your documentation edits did not pass `dox check`. Fix exactly these problems, then stop:",
    "",
    ...errors.map((e) => `- ${e}`)
  ].join("\n");
}

// src/run.ts
var DEFAULT_MODEL = "claude-sonnet-5";
async function runAgent(client, task, options) {
  const { projectDir, mode } = options;
  const model = options.model ?? process.env.DOX_AGENT_MODEL ?? DEFAULT_MODEL;
  const maxSteps = options.maxSteps ?? 24;
  const emit = options.onEvent ?? (() => {
  });
  assertCleanGitRepo(projectDir);
  const original = currentBranch(projectDir);
  const branch = `dox/agent-${Date.now().toString(36)}`;
  createBranch(projectDir, branch);
  const restore = () => {
    try {
      hardReset(projectDir);
    } catch {
    }
    try {
      checkoutBranch(projectDir, original);
    } catch {
    }
    try {
      deleteBranch(projectDir, branch);
    } catch {
    }
  };
  try {
    const { claudeTools, dispatch } = buildToolBridge(projectDir);
    const system = buildSystemPrompt(loadAgentsGuidance(projectDir));
    emit("Drafting documentation\u2026");
    const first = await runAgentLoop({
      client,
      model,
      maxSteps,
      system,
      userPrompt: buildUserPrompt(task),
      tools: claudeTools,
      dispatch,
      onEvent: (e) => emit(`  \u2192 ${e}`)
    });
    let summary = first.summary;
    let steps = first.steps;
    if (!hasChanges(projectDir)) {
      restore();
      return { branch, summary, steps, diff: "", validation: { ok: true, errors: [], warnings: [] }, noChanges: true };
    }
    let validation = runDocsCheck(projectDir);
    if (!validation.ok) {
      emit("Validation failed \u2014 attempting a repair\u2026");
      const repair = await runAgentLoop({
        client,
        model,
        maxSteps,
        system,
        userPrompt: buildRepairPrompt(validation.errors),
        tools: claudeTools,
        dispatch,
        onEvent: (e) => emit(`  \u2192 ${e}`)
      });
      if (repair.summary) summary = repair.summary;
      steps += repair.steps;
      validation = runDocsCheck(projectDir);
    }
    const diff = stagedDiff(projectDir);
    if (mode === "dry-run") {
      restore();
      return { branch, summary, steps, diff, validation, noChanges: false };
    }
    if (mode === "pr") {
      const title = `docs: ${task.instruction.slice(0, 60)}`;
      const body = `${summary}

---
${task.requester ? `Requested by ${task.requester}. ` : ""}Drafted by the Dox docs agent \u2014 please review.`;
      commitAll(projectDir, title);
      push(projectDir, branch);
      let prUrl;
      try {
        prUrl = execFileSync2("gh", ["pr", "create", "--title", title, "--body", body, "--head", branch], {
          cwd: projectDir,
          encoding: "utf8"
        }).trim();
      } catch (err) {
        throw new Error(
          `Changes committed and pushed to "${branch}", but opening the PR failed (is gh authenticated?): ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return { branch, summary, steps, diff, validation, prUrl, noChanges: false };
    }
    return { branch, summary, steps, diff, validation, noChanges: false };
  } catch (err) {
    restore();
    throw err;
  }
}

// src/context.ts
import { execFileSync as execFileSync3 } from "child_process";
function resolveDiff(projectDir, ref) {
  for (const args of [["diff", `${ref}...HEAD`], ["diff", ref]]) {
    try {
      const out = execFileSync3("git", args, { cwd: projectDir, encoding: "utf8" });
      if (out.trim()) return out.slice(0, 2e4);
    } catch {
    }
  }
  return "";
}
function resolvePrContext(prUrl) {
  let pr;
  try {
    const json = execFileSync3("gh", ["pr", "view", prUrl, "--json", "title,body,number,url"], { encoding: "utf8" });
    pr = JSON.parse(json);
  } catch (err) {
    throw new Error(`Could not read the PR via gh (is it installed and authenticated?): ${err instanceof Error ? err.message : String(err)}`);
  }
  let diff = "";
  try {
    diff = execFileSync3("gh", ["pr", "diff", prUrl], { encoding: "utf8" }).slice(0, 2e4);
  } catch {
  }
  return [
    `# Product PR #${pr.number}: ${pr.title}`,
    `URL: ${pr.url}`,
    "",
    pr.body?.trim() || "(no description)",
    diff ? `
## Diff
\`\`\`diff
${diff}
\`\`\`` : ""
  ].join("\n");
}

// src/scaffold.ts
import fs2 from "fs";
import path2 from "path";
var DOCS_AGENT_WORKFLOW = `name: Dox docs agent

on:
  # A product repo dispatches a docs task here (see the sender workflow).
  repository_dispatch:
    types: [dox-document]
  # Run it by hand from the Actions tab.
  workflow_dispatch:
    inputs:
      instruction:
        description: What to document
        required: true
      from_pr:
        description: Product PR URL (optional context)
        required: false
  # Weekly provenance drift sweep \u2014 flags pages whose sources changed.
  schedule:
    - cron: '0 6 * * 1'

permissions:
  contents: write
  pull-requests: write

jobs:
  document:
    if: github.event_name != 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Configure git
        run: |
          git config user.name "dox-agent"
          git config user.email "dox-agent@users.noreply.github.com"
      - name: Draft docs and open a PR
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          # A fine-grained PAT / App token with write on this docs repo (and read
          # on your product repos). Falls back to the built-in token.
          GH_TOKEN: \${{ secrets.DOX_AGENT_TOKEN || secrets.GITHUB_TOKEN }}
        run: |
          INSTRUCTION="\${{ github.event.client_payload.instruction || inputs.instruction }}"
          FROM_PR="\${{ github.event.client_payload.from_pr || inputs.from_pr }}"
          if [ -n "$FROM_PR" ]; then
            npx dox agent "$INSTRUCTION" --from-pr "$FROM_PR" --pr
          else
            npx dox agent "$INSTRUCTION" --pr
          fi

  drift-sweep:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Check for stale docs
        run: npx dox check --drift --ci
`;
function mentionSenderWorkflow(docsRepo) {
  return `name: Dox mention

on:
  issue_comment:
    types: [created]

jobs:
  dispatch:
    # Only PR comments from collaborators, starting with "@dox".
    if: >-
      github.event.issue.pull_request &&
      startsWith(github.event.comment.body, '@dox') &&
      contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch docs task
        env:
          GH_TOKEN: \${{ secrets.DOX_DISPATCH_TOKEN }}
        run: |
          INSTRUCTION="\${{ github.event.comment.body }}"
          PR_URL="\${{ github.event.issue.html_url }}"
          gh api repos/${docsRepo}/dispatches -f event_type=dox-document \\
            -F "client_payload[instruction]=\${INSTRUCTION#@dox }" \\
            -F "client_payload[from_pr]=$PR_URL" \\
            -F "client_payload[requester]=\${{ github.event.comment.user.login }}"
`;
}
function mergeSenderWorkflow(docsRepo) {
  return `name: Dox merge dispatch

on:
  push:
    branches: [main]
    paths:
      # Only fire when documented surface changes (match your docs.json watch globs).
      - 'src/**'
      - 'openapi.yaml'

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch docs task
        env:
          GH_TOKEN: \${{ secrets.DOX_DISPATCH_TOKEN }}
        run: |
          gh api repos/${docsRepo}/dispatches -f event_type=dox-document \\
            -F "client_payload[instruction]=Document the changes merged in \${{ github.repository }}@\${{ github.sha }}" \\
            -F "client_payload[from_pr]=\${{ github.event.head_commit.url }}"
`;
}
function codeownersFor(team = "@your-org/docs-admins") {
  return `# Changes to the admin team roster (the "team" block) require approval from a
# designated owner. REQUIRES branch protection on main (PRs + required review),
# otherwise a direct push bypasses this.
/docs.json   ${team}
`;
}
function scaffoldAgentWorkflow(projectDir, docsRepo = "<owner>/<docs-repo>") {
  const written = [];
  const wfDir = path2.join(projectDir, ".github", "workflows");
  fs2.mkdirSync(wfDir, { recursive: true });
  const wf = path2.join(wfDir, "dox-agent.yml");
  fs2.writeFileSync(wf, DOCS_AGENT_WORKFLOW);
  written.push(path2.relative(projectDir, wf));
  const co = path2.join(projectDir, ".github", "CODEOWNERS");
  if (!fs2.existsSync(co)) {
    fs2.writeFileSync(co, codeownersFor());
    written.push(path2.relative(projectDir, co));
  }
  return { written, senderSnippet: mentionSenderWorkflow(docsRepo) };
}
export {
  DOCS_AGENT_WORKFLOW,
  buildToolBridge,
  loadAgentsGuidance,
  mentionSenderWorkflow,
  mergeSenderWorkflow,
  resolveDiff,
  resolvePrContext,
  runAgent,
  runAgentLoop,
  scaffoldAgentWorkflow
};
