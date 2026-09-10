import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DOCUMENTATION_PATH =
  /^(?:AGENTS\.md$|README\.md$|CHANGELOG\.md$|(?:developing|docs)\/.*\.md$|changelog\/|\.agents\/skills\/.*(?:\.md|\/UPSTREAM\.json|\/LICENSE)$|\.claude\/.*\.md$)/u;
const CONTROL_PATH =
  /^(?:scripts\/(?:ci|release|dev)\/|\.github\/|package\.json$)/u;
const SOURCE_PATH = /\.[cm]?[jt]sx?$/u;
const NODE_SOURCE_PATH = /^scripts\/.*\.mjs$/u;
const VITEST_SCRIPT = /^vitest run(?: --(?:config|environment) [\w./-]+)*$/u;
const WHITESPACE = /\s+/u;
const NODE_EXTENSION = /\.mjs$/u;

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
    commands.push(["exec", "node", "--test", ...nodeTests]);
  }
  for (const workspace of options.workspaces ?? []) {
    if (!VITEST_SCRIPT.test(workspace.test ?? "")) {
      continue;
    }
    const sources = paths
      .filter(
        (file) =>
          file.startsWith(`${workspace.directory}/`) && SOURCE_PATH.test(file)
      )
      .map((file) => file.slice(workspace.directory.length + 1));
    if (sources.length > 0) {
      commands.push([
        "--dir",
        workspace.directory,
        "exec",
        "vitest",
        "related",
        "--run",
        ...workspace.test.split(WHITESPACE).slice(2),
        "--passWithNoTests",
        ...sources,
      ]);
    }
  }
  return commands;
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const base = process.env.OPENMELD_AFFECTED_BASE ?? "origin/main";
  const git = (args) => execFileSync("git", args, { encoding: "utf8" });
  const paths = [
    ...new Set(
      [
        git(["diff", "--name-only", "-z", `${base}...HEAD`]),
        git(["diff", "--name-only", "-z"]),
        git(["diff", "--cached", "--name-only", "-z"]),
        git(["ls-files", "--others", "--exclude-standard", "-z"]),
      ].flatMap((output) => output.split("\0").filter(Boolean))
    ),
  ];
  const feedback = process.argv.includes("--feedback");
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
            test: manifest.scripts?.test,
          };
        })
    : [];
  const commands = planPrChecks(paths, { feedback, existingFiles, workspaces });
  if (process.argv.includes("--plan")) {
    console.log(
      JSON.stringify(
        { base, mode: feedback ? "feedback" : "affected", paths, commands },
        null,
        2
      )
    );
  } else {
    process.exitCode = runPrChecks(commands);
  }
}
