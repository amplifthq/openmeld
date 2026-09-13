import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseTurboAffectedTaskArgs,
  resolveExplicitAffectedPackages,
  resolveTurboAffectedFilters,
  resolveTurboCommandArgs,
} from "./affected-workspaces.mjs";
import { acquireLocalResources, RESOURCE_TOKEN } from "./local-resources.mjs";
import { runOwnedCommand } from "./owned-command.mjs";

const DEFAULT_BASE_REF = "origin/main";
const LINE_SPLIT_REGEX = /\r?\n/u;
const LOCKFILE_PATH = "pnpm-lock.yaml";
const ROOT_FILTER = "!//";
const baseRef = process.env.OPENMELD_AFFECTED_BASE ?? DEFAULT_BASE_REF;
const args = process.argv.slice(2);
const separatorIndex = args.indexOf("--");
const taskArgs = separatorIndex === -1 ? args : args.slice(0, separatorIndex);
const { changedOnly, excludedPackages, taskNames } =
  parseTurboAffectedTaskArgs(taskArgs);
const extraArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1);

if (taskNames.length === 0) {
  console.error(
    "turbo-affected requires at least one task name, for example: node scripts/dev/turbo-affected.mjs --changed-only check test"
  );
  process.exit(1);
}

const gitBinary = process.platform === "win32" ? "git.exe" : "git";
const pnpmBinary = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const baseCheck = spawnSync(
  gitBinary,
  ["rev-parse", "--verify", `${baseRef}^{commit}`],
  { encoding: "utf8", stdio: "pipe" }
);

if (baseCheck.status !== 0) {
  console.error(
    [
      `Affected run requires the base ref "${baseRef}" to exist locally.`,
      'Run "git fetch origin main --depth=1" or set OPENMELD_AFFECTED_BASE to another available ref.',
      baseCheck.stderr.trim(),
    ]
      .filter((line) => line.length > 0)
      .join("\n")
  );
  process.exit(baseCheck.status ?? 1);
}

const changedPaths = resolveChangedPaths();
const explicitAffectedPackages = changedPaths.includes(LOCKFILE_PATH)
  ? resolveExplicitAffectedPackages({
      changedPaths,
      lockfileDiff: resolveLockfileDiff(),
      workspacePackages: readWorkspacePackages(),
    })
  : null;
const affectedFilters = resolveTurboAffectedFilters({
  baseRef,
  changedOnly,
  excludedPackages,
  explicitAffectedPackages,
  lockfileChanged: changedPaths.includes(LOCKFILE_PATH),
});
const turboArgs = resolveTurboCommandArgs({
  dlxPackage: process.env.OPENMELD_TURBO_DLX_PACKAGE,
  turboRunArgs: [
    "run",
    ...taskNames,
    ...affectedFilters,
    `--filter=${ROOT_FILTER}`,
    ...(extraArgs.some(
      (arg) => arg === "--concurrency" || arg.startsWith("--concurrency=")
    )
      ? []
      : [
          taskNames.includes("test:integration")
            ? "--concurrency=1"
            : "--concurrency=2",
        ]),
    ...extraArgs,
  ],
});
const controller = new AbortController();
const cancel = () =>
  controller.abort(new Error("Affected validation cancelled before launch."));
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
let reservation;
try {
  if (!process.env.GITHUB_ACTIONS) {
    reservation = await acquireLocalResources({
      kind: "heavy",
      signal: controller.signal,
    });
  }
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
  process.exitCode = await runOwnedCommand(pnpmBinary, turboArgs, {
    env: {
      ...process.env,
      ...(reservation ? { [RESOURCE_TOKEN]: reservation.token } : {}),
    },
  });
} finally {
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
  await reservation?.release();
}

function resolveChangedPaths() {
  const outputs = [
    execFileSync(gitBinary, ["diff", "--name-only", `${baseRef}...HEAD`], {
      encoding: "utf8",
    }),
    execFileSync(gitBinary, ["diff", "--name-only"], { encoding: "utf8" }),
    execFileSync(gitBinary, ["diff", "--cached", "--name-only"], {
      encoding: "utf8",
    }),
    execFileSync(gitBinary, ["ls-files", "--others", "--exclude-standard"], {
      encoding: "utf8",
    }),
  ];
  return [...new Set(outputs.flatMap(splitLines))].toSorted();
}

function resolveLockfileDiff() {
  return [
    execFileSync(
      gitBinary,
      ["diff", `${baseRef}...HEAD`, "--", LOCKFILE_PATH],
      { encoding: "utf8" }
    ),
    execFileSync(gitBinary, ["diff", "--", LOCKFILE_PATH], {
      encoding: "utf8",
    }),
    execFileSync(gitBinary, ["diff", "--cached", "--", LOCKFILE_PATH], {
      encoding: "utf8",
    }),
  ].join("\n");
}

function readWorkspacePackages() {
  const listedPackages = JSON.parse(
    execFileSync(pnpmBinary, ["-r", "list", "--depth", "-1", "--json"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 5,
    })
  );
  const repoRoot = process.cwd();
  return listedPackages
    .filter(
      (listedPackage) =>
        typeof listedPackage.name === "string" &&
        typeof listedPackage.path === "string" &&
        path.resolve(listedPackage.path) !== path.resolve(repoRoot)
    )
    .map((listedPackage) => {
      const packageJson = JSON.parse(
        readFileSync(path.join(listedPackage.path, "package.json"), "utf8")
      );
      return {
        dependencies: Object.keys({
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
          ...packageJson.optionalDependencies,
          ...packageJson.peerDependencies,
        }),
        name: listedPackage.name,
        relativePath: path
          .relative(repoRoot, listedPackage.path)
          .split(path.sep)
          .join("/"),
      };
    });
}

function splitLines(value) {
  return String(value).split(LINE_SPLIT_REGEX).filter(Boolean);
}
