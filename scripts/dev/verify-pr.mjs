import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DOCUMENTATION_PATH =
  /^(?:AGENTS\.md$|README\.md$|CHANGELOG\.md$|(?:developing|docs)\/.*\.md$|changelog\/|\.agents\/skills\/.*(?:\.md|\/UPSTREAM\.json|\/LICENSE)$|\.claude\/.*\.md$)/u;
const CONTROL_PATH =
  /^(?:scripts\/(?:ci|release|dev)\/|\.github\/|package\.json$)/u;

export function planPrChecks(paths) {
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
      ],
      [
        "exec",
        "node",
        "scripts/dev/turbo-affected.mjs",
        "test",
        "--",
        "--concurrency=2",
      ]
    );
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
  const commands = planPrChecks(paths);
  if (process.argv.includes("--plan")) {
    console.log(JSON.stringify({ base, paths, commands }, null, 2));
  } else {
    process.exitCode = runPrChecks(commands);
  }
}
