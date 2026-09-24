import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isWorkerZodImportCheckPath } from "../cloudflare/worker-zod-import-contract.mjs";
import { isCliSkillCheckPath } from "../release/cli-skill-check.mjs";

const DOCUMENTATION_PATH =
  /^(?:AGENTS\.md$|CLAUDE\.md$|README\.md$|CHANGELOG\.md$|(?:developing|docs)\/.*\.md$|changelog\/|\.agents\/skills\/.*(?:\.md|\/UPSTREAM\.json|\/LICENSE)$|\.claude\/.*\.md$)/u;
const CONTROL_PATH =
  /^(?:scripts\/(?:ci|release|dev)\/|\.github\/|package\.json$)/u;
const SOURCE_PATH = /\.[cm]?[jt]sx?$/u;
const NODE_SOURCE_PATH = /^scripts\/.*\.mjs$/u;
const VITEST_SCRIPT = /^vitest run(?: --(?:config|environment) [\w./-]+)*$/u;
const WHITESPACE = /\s+/u;
const NODE_EXTENSION = /\.mjs$/u;
const SCRIPT_ALIAS = /^pnpm run ([\w:-]+)$/u;

// Resolve plain unit-test aliases, never reinterpret shell pipelines or Worker
// integration commands. Unsupported runners retain their package-owned command.
export function resolveUnitTestScript(
  scripts,
  name = "test",
  seen = new Set()
) {
  if (seen.has(name)) {
    throw new Error(`Circular test script alias: ${name}`);
  }
  seen.add(name);
  const command = scripts?.[name];
  const alias = SCRIPT_ALIAS.exec(command ?? "");
  return alias ? resolveUnitTestScript(scripts, alias[1], seen) : command;
}

export function planPrChecks(paths, options = {}) {
  const commands = options.workspace ? [] : planGlobalChecks(paths);
  if (options.feedback) {
    const focusedOptions = {
      ...options,
      includeCommon: !options.workspace,
      buildWorkspaces: options.shared ? options.workspaces : undefined,
      workspaces: selectFeedbackWorkspaces(options),
    };
    return [...commands, ...planFocusedChecks(paths, focusedOptions)];
  }
  if (paths.some((file) => CONTROL_PATH.test(file))) {
    commands.push(["run", "verify:release-workflows"]);
  }
  if (paths.some((file) => !DOCUMENTATION_PATH.test(file))) {
    // Preserve Turbo's package graph, lockfile handling, and downstream selection.
    // Keep check and test sequential to avoid concurrent typecheck/test heaps.
    commands.push(
      [
        "exec",
        "node",
        "scripts/dev/turbo-affected.mjs",
        "check",
        "--",
        "--concurrency=2",
        "--log-order=stream",
      ],
      [
        "exec",
        "node",
        "scripts/dev/turbo-affected.mjs",
        "test",
        "--",
        "--concurrency=2",
        "--log-order=stream",
      ]
    );
  }
  return commands;
}

function planGlobalChecks(paths) {
  const commands = [];
  if (paths.some(isWorkerZodImportCheckPath)) {
    commands.push(["run", "verify:worker-zod-imports"]);
  }
  if (paths.some(isCliSkillCheckPath)) {
    commands.push(["run", "verify:cli-skill"]);
  }
  if (paths.some((file) => DOCUMENTATION_PATH.test(file))) {
    commands.push(["run", "verify:docs", "--", "--strict"]);
  }
  if (
    paths.some(
      (file) => file.startsWith("changelog/") || file === "CHANGELOG.md"
    )
  ) {
    commands.push(["run", "verify:changelog"]);
  }
  return commands;
}

function selectFeedbackWorkspaces(options) {
  if (options.workspace) {
    return (options.workspaces ?? []).filter(
      (item) => item.directory === options.workspace
    );
  }
  return options.shared ? [] : options.workspaces;
}

function planFocusedChecks(paths, options) {
  const existingFiles = new Set(options.existingFiles ?? paths);
  const changedFiles = paths.filter((file) => existingFiles.has(file));
  const commands = [];
  if (
    options.includeCommon &&
    changedFiles.some((file) => !DOCUMENTATION_PATH.test(file))
  ) {
    commands.push([
      "exec",
      "biome",
      "check",
      "--no-errors-on-unmatched",
      "--",
      ...changedFiles,
    ]);
  }
  const nodeTests = options.includeCommon
    ? [
        ...new Set(
          paths
            .filter((file) => NODE_SOURCE_PATH.test(file))
            .map((file) =>
              file.endsWith(".test.mjs")
                ? file
                : file.replace(NODE_EXTENSION, ".test.mjs")
            )
            .filter((file) => existingFiles.has(file))
        ),
      ].toSorted()
    : [];
  const nodeTestCommand =
    nodeTests.length > 0
      ? ["exec", "node", "--test", "--test-concurrency=1", ...nodeTests]
      : null;
  const workspaceCommands = [];
  const buildFilters = [];
  const buildWorkspaces = options.buildWorkspaces ?? options.workspaces ?? [];
  const buildDirectories = new Set(
    feedbackWorkspaces(paths, buildWorkspaces).map(({ directory }) => directory)
  );
  for (const workspace of buildWorkspaces) {
    if (buildDirectories.has(workspace.directory) && workspace.name) {
      // Plain package runners can import their own dist; Vitest runs source.
      const filter = VITEST_SCRIPT.test(workspace.test)
        ? `${workspace.name}^...`
        : `${workspace.name}...`;
      buildFilters.push(`--filter=${filter}`);
    }
  }
  for (const workspace of options.workspaces ?? []) {
    const command = focusedWorkspaceCommand(paths, workspace);
    if (command) {
      workspaceCommands.push(command);
    }
  }
  if (buildFilters.length > 0) {
    commands.push([
      "exec",
      "turbo",
      "run",
      "build",
      ...buildFilters,
      "--concurrency=1",
    ]);
  }
  if (nodeTestCommand) {
    commands.push(nodeTestCommand);
  }
  return [...commands, ...workspaceCommands];
}

function focusedWorkspaceCommand(paths, workspace) {
  if (!workspace.test) {
    return null;
  }
  const sources = paths
    .filter(
      (file) =>
        file.startsWith(`${workspace.directory}/`) && SOURCE_PATH.test(file)
    )
    .map((file) => file.slice(workspace.directory.length + 1));
  if (sources.length === 0) {
    return null;
  }
  if (!VITEST_SCRIPT.test(workspace.test)) {
    return ["--dir", workspace.directory, "run", "test"];
  }
  return [
    "--dir",
    workspace.directory,
    "exec",
    "vitest",
    "related",
    "--run",
    ...workspace.test.split(WHITESPACE).slice(2),
    "--passWithNoTests",
    "--maxWorkers=2",
    "--no-file-parallelism",
    ...sources,
  ];
}

export function feedbackWorkspaces(paths, workspaces) {
  return workspaces
    .filter(
      (workspace) =>
        workspace.test &&
        paths.some(
          (file) =>
            file.startsWith(`${workspace.directory}/`) && SOURCE_PATH.test(file)
        )
    )
    .map(({ directory }) => ({ directory }));
}

export function runPrChecks(commands, run = spawnSync) {
  for (const args of commands) {
    console.log(`$ pnpm ${args.join(" ")}`);
    const result = run("pnpm", args, { stdio: "inherit" });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

export function runVerification(options = {}) {
  const base =
    options.base ?? process.env.OPENMELD_AFFECTED_BASE ?? "origin/main";
  const git = (args) => execFileSync("git", args, { encoding: "utf8" });
  const paths = [
    ...new Set(
      [
        git(["diff", "--name-only", "-z", `${base}...HEAD`]),
        ...(options.committed
          ? []
          : [
              git(["diff", "--name-only", "-z"]),
              git(["diff", "--cached", "--name-only", "-z"]),
              git(["ls-files", "--others", "--exclude-standard", "-z"]),
            ]),
      ].flatMap((output) => output.split("\0").filter(Boolean))
    ),
  ];
  const feedback = options.feedback ?? false;
  const existingFiles = git([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter((file) => file && existsSync(file));
  const workspaces = feedback
    ? existingFiles
        .filter((file) => file.endsWith("/package.json"))
        .map((file) => {
          const manifest = JSON.parse(readFileSync(file, "utf8"));
          return {
            directory: path.posix.dirname(file),
            name: manifest.name,
            test: resolveUnitTestScript(manifest.scripts),
          };
        })
    : [];
  if (options.matrix) {
    console.log(
      JSON.stringify({ include: feedbackWorkspaces(paths, workspaces) })
    );
    return 0;
  }
  if (
    options.workspace &&
    !feedbackWorkspaces(paths, workspaces).some(
      (item) => item.directory === options.workspace
    )
  ) {
    throw new Error(`No selected feedback workspace: ${options.workspace}`);
  }
  const commands = planPrChecks(paths, {
    feedback,
    existingFiles,
    workspaces,
    shared: options.shared,
    workspace: options.workspace,
  });
  if (options.plan) {
    console.log(
      JSON.stringify(
        { base, mode: feedback ? "feedback" : "affected", paths, commands },
        null,
        2
      )
    );
    return 0;
  }
  const lane = mkdtempSync(path.join(tmpdir(), "openmeld-focused-checks-"));
  const validationEnv = { ...process.env, OPENMELD_HOME: lane };
  // Hooks export repository-local Git state. Tests that create temporary repos
  // must not inherit the pushed worktree's GIT_DIR/GIT_INDEX_FILE, etc.
  for (const name of git(["rev-parse", "--local-env-vars"])
    .trim()
    .split(WHITESPACE)) {
    delete validationEnv[name];
  }
  try {
    console.log(
      `Focused validation: ${base}...HEAD; isolated OPENMELD_HOME=${lane}`
    );
    return runPrChecks(commands, (binary, args, spawnOptions) =>
      spawnSync(binary, args, {
        ...spawnOptions,
        env: validationEnv,
      })
    );
  } finally {
    rmSync(lane, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = runVerification({
    feedback: process.argv.includes("--feedback"),
    committed: process.argv.includes("--committed"),
    plan: process.argv.includes("--plan"),
    matrix: process.argv.includes("--matrix"),
    shared: process.argv.includes("--shared"),
    workspace: process.env.VERIFY_PR_WORKSPACE,
  });
}
