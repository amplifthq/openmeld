import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  const commands = [];
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
  if (!options.feedback && paths.some((file) => CONTROL_PATH.test(file))) {
    commands.push(["run", "verify:release-workflows"]);
  }
  if (options.feedback) {
    return [...commands, ...planFocusedChecks(paths, options)];
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

function planFocusedChecks(paths, options) {
  const existingFiles = new Set(options.existingFiles ?? paths);
  const changedFiles = paths.filter((file) => existingFiles.has(file));
  const commands = [];
  if (changedFiles.some((file) => !DOCUMENTATION_PATH.test(file))) {
    commands.push([
      "exec",
      "biome",
      "check",
      "--no-errors-on-unmatched",
      "--",
      ...changedFiles,
    ]);
  }
  const nodeTests = [
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
  ].toSorted();
  if (nodeTests.length > 0) {
    commands.push([
      "exec",
      "node",
      "--test",
      "--test-concurrency=1",
      ...nodeTests,
    ]);
  }
  const workspaceCommands = [];
  const buildFilters = [];
  for (const workspace of options.workspaces ?? []) {
    const sources = paths
      .filter(
        (file) =>
          file.startsWith(`${workspace.directory}/`) && SOURCE_PATH.test(file)
      )
      .map((file) => file.slice(workspace.directory.length + 1));
    if (sources.length > 0 && workspace.test) {
      if (workspace.name) {
        buildFilters.push(`--filter=${workspace.name}^...`);
      }
      if (!VITEST_SCRIPT.test(workspace.test ?? "")) {
        workspaceCommands.push(["--dir", workspace.directory, "run", "test"]);
        continue;
      }
      workspaceCommands.push([
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
      ]);
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
  return [...commands, ...workspaceCommands];
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
  const commands = planPrChecks(paths, { feedback, existingFiles, workspaces });
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
  try {
    console.log(
      `Focused validation: ${base}...HEAD; isolated OPENMELD_HOME=${lane}`
    );
    return runPrChecks(commands, (binary, args, spawnOptions) =>
      spawnSync(binary, args, {
        ...spawnOptions,
        env: { ...process.env, OPENMELD_HOME: lane },
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
  });
}
