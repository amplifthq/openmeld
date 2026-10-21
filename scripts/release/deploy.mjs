#!/usr/bin/env node

// Production release orchestrator. It does three things only: select
// components (release/components.mjs paths or an explicit scope), order them
// (dependsOn), and run them (local deploy-component.mjs or top-level GitHub
// dispatches). CLI uses cli-release.yml to preserve its npm OIDC identity.
// Special receiver-first orders are separate explicit invocations.
//
//   pnpm run deploy -- --scope <auto|cloud|name[,name]> --lane <local|github|auto>
//                      [--sha <sha>] [--base <sha>] [--dry-run]

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { COMPONENTS, SCOPE_ALIASES } from "../../release/components.mjs";
import { buildNestedDopplerCommand } from "../dev/doppler-environment.mjs";
import { readLiveReleaseSha } from "./live-release.mjs";
import { requireMainlineReleaseSha } from "./require-mainline-release-sha.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FULL_SHA = /^[0-9a-f]{40}$/u;
const LANES = new Set(["local", "github", "auto"]);
const GITHUB_REMOTE = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/u;
const RUN_URL = /\/actions\/runs\/(\d+)/u;
const ROOT_BUILD_INPUTS = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  ".nvmrc",
]);
const RELEASE_SECRETS = {
  project: "openmeld-release",
  config: "prd",
  requiredSecrets: [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN",
  ],
  optionalSecrets: [],
};

export function parseDeployArgs(argv) {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== "--"),
    options: {
      scope: { type: "string" },
      lane: { type: "string", default: "auto" },
      sha: { type: "string" },
      base: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (!values.scope) {
    throw new Error(
      "--scope is required: auto, cloud, or a comma-separated component list."
    );
  }
  if (!LANES.has(values.lane)) {
    throw new Error("--lane must be local, github, or auto.");
  }
  return {
    scope: values.scope,
    lane: values.lane,
    sha: values.sha,
    base: values.base,
    dryRun: values["dry-run"],
  };
}

export function expandScope(scope) {
  if (scope === "auto") {
    return null;
  }
  const names = scope
    .split(",")
    .flatMap((name) => SCOPE_ALIASES[name.trim()] ?? [name.trim()]);
  for (const name of names) {
    if (!COMPONENTS.some((component) => component.name === name)) {
      throw new Error(
        `Unknown component "${name}". Known: ${COMPONENTS.map((c) => c.name).join(", ")}, cloud, auto.`
      );
    }
  }
  return [...new Set(names)];
}

export function componentMatchesPath(component, file) {
  const include = component.paths.filter((pattern) => !pattern.startsWith("!"));
  const exclude = component.paths
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));
  return (
    include.some((pattern) => path.matchesGlob(file, pattern)) &&
    !exclude.some((pattern) => path.matchesGlob(file, pattern))
  );
}

// Stable topological order: table order, each component after its selected
// dependencies. Unselected dependencies do not pull anything in.
export function orderComponents(names) {
  const selected = new Set(names);
  const ordered = [];
  const visit = (component, trail = []) => {
    if (ordered.includes(component.name)) {
      return;
    }
    if (trail.includes(component.name)) {
      throw new Error(
        `release/components.mjs has a dependency cycle: ${[...trail, component.name].join(" -> ")}.`
      );
    }
    for (const dependency of component.dependsOn) {
      if (selected.has(dependency)) {
        visit(
          COMPONENTS.find((entry) => entry.name === dependency),
          [...trail, component.name]
        );
      }
    }
    ordered.push(component.name);
  };
  for (const component of COMPONENTS) {
    if (selected.has(component.name)) {
      visit(component);
    }
  }
  return ordered;
}

// Consecutive components on the same lane and workflow form one segment.
// CLI must remain a top-level dispatch for npm Trusted Publishing. Segments
// run in order, so CLI publication waits for selected cloud dependencies.
export function planLaneSegments(
  names,
  lane,
  defaultLaneOf = (name) =>
    COMPONENTS.find((entry) => entry.name === name).defaultLane
) {
  const segments = [];
  for (const name of names) {
    const componentLane = lane === "auto" ? defaultLaneOf(name) : lane;
    const component = COMPONENTS.find((entry) => entry.name === name);
    if (component.lanes && !component.lanes.includes(componentLane)) {
      throw new Error(
        `${name} cannot run on --lane ${componentLane}. Use --lane github.`
      );
    }
    const last = segments.at(-1);
    const sameWorkflow =
      componentLane !== "github" ||
      last?.components.includes("cli") === (name === "cli");
    if (last?.lane === componentLane && sameWorkflow) {
      last.components.push(name);
    } else {
      segments.push({ lane: componentLane, components: [name] });
    }
  }
  return segments;
}

// For --scope auto: diff each component from the SHA it runs now (or --base
// when the platform cannot say) to the target, and select it when a changed
// path matches its own paths.
export async function planAutoScope({ sha, base, git, readLive }) {
  const plan = [];
  const unknown = [];
  for (const component of COMPONENTS) {
    let live = null;
    try {
      live = await readLive(component);
    } catch (error) {
      process.stderr.write(
        `warning: could not read live ${component.name} release: ${error.message}\n`
      );
    }
    if (live === sha) {
      plan.push({
        name: component.name,
        from: live,
        current: true,
        changedPaths: [],
      });
      continue;
    }
    const from = live && git.isAncestor(live, sha) ? live : base;
    if (!from) {
      unknown.push(component.name);
      continue;
    }
    const changedPaths = git.diffNames(from, sha);
    plan.push({
      name: component.name,
      from,
      fromLive: from === live,
      current: false,
      changedPaths: changedPaths.filter((file) =>
        componentMatchesPath(component, file)
      ),
      rootInputs: changedPaths.filter((file) => ROOT_BUILD_INPUTS.has(file)),
    });
  }
  if (unknown.length > 0) {
    throw new Error(
      `Cannot read the live release SHA of ${unknown.join(", ")}. Pass --base <pre-merge-sha> to diff from a known source.`
    );
  }
  return plan;
}

function createGit(cwd) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return {
    run: git,
    isAncestor(ancestor, descendant) {
      return (
        spawnSync(
          "git",
          ["merge-base", "--is-ancestor", ancestor, descendant],
          { cwd }
        ).status === 0
      );
    },
    diffNames(from, to) {
      return git(["diff", "--name-only", `${from}...${to}`])
        .split("\n")
        .filter(Boolean);
    },
  };
}

function resolveRepository(git) {
  const url = git.run(["remote", "get-url", "origin"]);
  const match = GITHUB_REMOTE.exec(url);
  if (!match) {
    throw new Error(`origin (${url}) is not a GitHub repository.`);
  }
  return match[1];
}

function runOrThrow(command, args, options) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${[command, ...args].join(" ")} failed with exit code ${String(result.status)}.`
    );
  }
}

export function buildLocalCommand(name, sha, env = process.env) {
  const command = [
    process.execPath,
    path.join(SCRIPT_DIRECTORY, "deploy-component.mjs"),
    name,
    "--sha",
    sha,
  ];
  if (env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN) {
    return { executable: command[0], args: command.slice(1) };
  }
  return buildNestedDopplerCommand({
    sources: [RELEASE_SECRETS],
    terminalArgs: command,
  });
}

export function buildGithubDispatch({ repository, sha, components }) {
  const isCli = components.includes("cli");
  if (isCli && components.length !== 1) {
    throw new Error(
      "CLI publication must be dispatched separately through cli-release.yml."
    );
  }
  return [
    "workflow",
    "run",
    isCli ? "cli-release.yml" : "deploy.yml",
    "--repo",
    repository,
    "--ref",
    "main",
    ...(isCli
      ? ["-f", `release_sha=${sha}`]
      : ["-f", `sha=${sha}`, "-f", `scopes=${components.join(",")}`]),
  ];
}

function runLocalSegment({ components, sha, cwd }) {
  for (const name of components) {
    const component = COMPONENTS.find((entry) => entry.name === name);
    if (component.heavy) {
      process.stdout.write(`\n${name} is heavy locally: ${component.heavy}.\n`);
    }
    const startedAt = Date.now();
    const command = buildLocalCommand(name, sha);
    runOrThrow(command.executable, command.args, { cwd });
    process.stdout.write(
      `[deploy] ${name} done in ${Math.round((Date.now() - startedAt) / 1000)}s\n`
    );
  }
}

function runGithubSegment({ components, sha, repository }) {
  const output = execFileSync(
    "gh",
    buildGithubDispatch({ repository, sha, components }),
    { encoding: "utf8" }
  );
  process.stdout.write(output);
  const runId = RUN_URL.exec(output)?.[1];
  if (!runId) {
    throw new Error(
      "gh did not print the created run URL. Upgrade gh, then follow the run in GitHub Actions; do not dispatch again."
    );
  }
  runOrThrow("gh", [
    "run",
    "watch",
    runId,
    "--repo",
    repository,
    "--exit-status",
    "--interval",
    "15",
  ]);
}

function assertLocalSource(git, sha) {
  if (git.run(["status", "--porcelain"])) {
    throw new Error(
      "The local lane needs a clean checkout of the release SHA."
    );
  }
  if (git.run(["rev-parse", "HEAD"]) !== sha) {
    throw new Error(`The local lane deploys HEAD; check out ${sha} first.`);
  }
}

export async function selectAutoScope(input) {
  const plan = await planAutoScope(input);
  for (const entry of plan) {
    const source = entry.fromLive ? "live" : "--base";
    const state = entry.current
      ? "current"
      : `${entry.changedPaths.length} matching path(s) since ${entry.from.slice(0, 12)} (${source})`;
    process.stdout.write(`${entry.name.padEnd(13)} ${state}\n`);
  }
  const rootInputs = [
    ...new Set(plan.flatMap((entry) => entry.rootInputs ?? [])),
  ];
  if (rootInputs.length > 0) {
    process.stdout.write(
      `note: root build inputs changed (${rootInputs.join(", ")}); scope is not widened. Name components explicitly if they must rebuild.\n`
    );
  }
  const selected = plan
    .filter((entry) => entry.changedPaths.length > 0)
    .map((entry) => entry.name);
  if (selected.includes("db") && !selected.includes("core")) {
    process.stderr.write(
      "warning: the migration will run against the live Core; use --scope db,core unless the migration is safe for the Core that is live now.\n"
    );
  }
  return selected;
}

function printSegment({ segment, sha, repository, dryRun }) {
  process.stdout.write(
    `[${segment.lane}] ${segment.components.join(" -> ")}\n`
  );
  if (!dryRun) {
    return;
  }
  const commands =
    segment.lane === "github"
      ? [
          [
            "gh",
            ...buildGithubDispatch({
              repository,
              sha,
              components: segment.components,
            }),
          ],
        ]
      : segment.components.map((name) => {
          const local = buildLocalCommand(name, sha);
          return [local.executable, ...local.args];
        });
  for (const command of commands) {
    process.stdout.write(`  $ ${command.join(" ")}\n`);
  }
}

export async function deploy(options, { cwd = process.cwd(), readLive } = {}) {
  const git = createGit(cwd);
  git.run(["fetch", "--quiet", "origin", "main"]);
  const sha = options.sha ?? git.run(["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(sha)) {
    throw new Error(
      "--sha must be an exact 40-character lowercase commit SHA."
    );
  }
  requireMainlineReleaseSha({
    cwd,
    releaseSha: sha,
    mainRef: "refs/remotes/origin/main",
  });

  const names =
    expandScope(options.scope) ??
    (await selectAutoScope({
      sha,
      base: options.base,
      git,
      readLive:
        readLive ?? ((component) => readLiveReleaseSha(component, COMPONENTS)),
    }));
  const ordered = orderComponents(names);
  const segments = planLaneSegments(ordered, options.lane);
  const repository = resolveRepository(git);
  if (ordered.length === 0) {
    process.stdout.write("Nothing to release.\n");
    return { sha, segments };
  }
  for (const segment of segments) {
    printSegment({ segment, sha, repository, dryRun: options.dryRun });
  }
  if (options.dryRun) {
    return { sha, segments };
  }
  if (segments.some((segment) => segment.lane === "local")) {
    assertLocalSource(git, sha);
    const controlRoot = path.resolve(SCRIPT_DIRECTORY, "../..");
    const controlGit = createGit(controlRoot);
    if (controlRoot !== path.resolve(cwd)) {
      controlGit.run(["fetch", "--quiet", "origin", "main"]);
    }
    if (
      controlGit.run(["rev-parse", "HEAD"]) !==
        controlGit.run(["rev-parse", "refs/remotes/origin/main"]) ||
      controlGit.run(["status", "--porcelain"])
    ) {
      throw new Error(
        "Local release control must come from a clean checkout of current origin/main. Run that deploy.mjs by absolute path from the product checkout."
      );
    }
  }
  const startedAt = Date.now();
  for (const segment of segments) {
    if (segment.lane === "local") {
      runLocalSegment({ components: segment.components, sha, cwd });
    } else {
      runGithubSegment({ components: segment.components, sha, repository });
    }
  }
  process.stdout.write(
    `Released ${ordered.join(", ")} at ${sha} in ${Math.round((Date.now() - startedAt) / 1000)}s.\n`
  );
  return { sha, segments };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await deploy(parseDeployArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
