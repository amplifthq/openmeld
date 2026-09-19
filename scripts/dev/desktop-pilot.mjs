import { execFileSync } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  checkDesktopWebBuild,
  desktopDevelopmentPlan,
  desktopSourceIdentity,
  inspectMacCallback,
  isDesktopBuildReusable,
  prepareDesktopBundle,
} from "./desktop-worktree-build.mjs";
import {
  desktopProcessSnapshot,
  readDesktopRecord,
  stopDesktopWorktree,
  withDesktopWorktreeOwner,
  writeDesktopRecord,
} from "./desktop-worktree-state.mjs";
import {
  buildIsolatedDevEnvironment,
  readCurrentIsolatedDevLane,
} from "./dev-isolated-lane.mjs";
import { acquireLocalResources, RESOURCE_TOKEN } from "./local-resources.mjs";
import { runOwnedCommand } from "./owned-command.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function resolveDesktopPilotLaunch({
  lane,
  root = repoRoot,
  preset = "dev-local",
  env = process.env,
  appPath,
}) {
  if (preset !== "dev-local" && preset !== "canary") {
    throw new Error("Desktop pilot requires a development preset.");
  }
  if (resolve(lane.repoRoot) !== resolve(root)) {
    throw new Error("Desktop pilot lane belongs to another worktree.");
  }
  const cli = join(lane.openMeldHome, "bin", "openmeld");
  try {
    accessSync(cli, constants.X_OK);
    if (!realpathSync(cli).startsWith(realpathSync(lane.openMeldHome) + sep)) {
      throw new Error("CLI resolves outside the lane home.");
    }
  } catch (cause) {
    throw new Error(
      `Desktop pilot requires this lane's installed CLI at ${cli}. Complete this worktree's Web setup first.`,
      { cause }
    );
  }
  const userData = join(
    lane.openMeldHome,
    "desktop",
    "mock-keychain-user-data"
  );
  const executable = appPath
    ? resolve(appPath, "Contents/MacOS", basename(appPath, ".app"))
    : "pnpm";
  if (appPath) {
    try {
      accessSync(executable, constants.X_OK);
    } catch (cause) {
      throw new Error(
        "Private Desktop app is missing its executable. Pass the built .app path.",
        { cause }
      );
    }
  }
  const launchEnv = {
    ...env,
    ...buildIsolatedDevEnvironment(lane),
    OPENMELD_ENV_PRESET: preset,
    OPENMELD_USER_FACING_CLI_COMMAND: cli,
    OPENMELD_BIN: cli,
    OPENMELD_DESKTOP_PILOT: "1",
    OPENMELD_DESKTOP_USER_DATA_DIR: userData,
  };
  if (appPath) {
    launchEnv.OPENMELD_DESKTOP_RENDERER_DIR = undefined;
  } else {
    launchEnv.OPENMELD_DESKTOP_RENDERER_DIR = join(
      root,
      "clients/web/dist/client"
    );
  }
  return {
    cwd: root,
    env: launchEnv,
    command: executable,
    args: appPath
      ? [`--user-data-dir=${userData}`]
      : [
          "--dir",
          "clients/desktop",
          "exec",
          "electron",
          ".",
          `--user-data-dir=${userData}`,
        ],
  };
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      app: { type: "string" },
      json: { type: "boolean" },
      force: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(
      "Desktop worktree commands: desktop:dev [canary], desktop:prepare [--force], desktop:doctor [--json], desktop:status [--json], desktop:stop [--dry-run]. Start Workers with dev:worktree and matching compiled Web with desktop:web. Desktop manages its own build/runtime resources; do not wrap it in dev:run. No command stops Web, Service, or another worktree."
    );
    return;
  }
  const action =
    positionals[0] === "canary" ? "start" : (positionals[0] ?? "start");
  const preset = positionals.includes("canary") ? "canary" : "dev-local";
  if (
    !["start", "prepare", "doctor", "status", "stop"].includes(action) ||
    positionals.length > 2 ||
    (positionals.length === 2 && positionals[1] !== "canary")
  ) {
    throw new Error("Unknown Desktop command. Run pnpm desktop:dev --help.");
  }
  if (values.app && action !== "start") {
    throw new Error("--app is supported only for desktop:start:package.");
  }
  if (action === "stop") {
    const stopped = await stopDesktopWorktree(repoRoot, {
      dryRun: values["dry-run"],
    });
    console.log(JSON.stringify(stopped));
    return;
  }
  if (action === "doctor" || action === "status") {
    await printDesktopStatus(action, values.json);
    return;
  }
  if (process.env[RESOURCE_TOKEN]) {
    throw new Error(
      "Desktop owns short build and lightweight GUI reservations. Run pnpm desktop:dev directly, outside an existing dev:run command."
    );
  }
  const already = desktopProcessSnapshot(repoRoot);
  if (already.running) {
    console.log(
      `Desktop is already running for this worktree (PIDs ${already.processes.map((row) => row.pid).join(", ")}). No build or duplicate process was started. Use desktop:status or desktop:stop.`
    );
    return;
  }
  const lane = readCurrentIsolatedDevLane(repoRoot);
  const launch = resolveDesktopPilotLaunch({
    lane,
    preset,
    appPath: values.app,
  });
  if (launch.env.AUTH_DESKTOP_DEVELOPMENT_TARGET === "disposable") {
    throw new Error(
      "This backend uses the disposable installed identity. Use the installed test package workflow, not the worktree development app."
    );
  }
  console.log(
    `Desktop pilot: ${lane.laneId}\nWeb: ${launch.env.WEB_APP_URL}\nOPENMELD_HOME: ${lane.openMeldHome}\nCLI: ${launch.env.OPENMELD_BIN}\nGUI data: ${launch.env.OPENMELD_DESKTOP_USER_DATA_DIR}`
  );
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Desktop launch cancelled."));
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    await withDesktopWorktreeOwner(
      repoRoot,
      controller.signal,
      async (owner) => {
        let command = launch.command;
        let args = launch.args;
        if (!values.app && process.platform === "darwin") {
          const plan = await prepareMacDesktop(
            lane,
            launch,
            values,
            controller.signal
          );
          command = plan.executable;
          args = [
            `--user-data-dir=${launch.env.OPENMELD_DESKTOP_USER_DATA_DIR}`,
          ];
          if (action === "prepare") {
            return;
          }
          registerMacDesktop(plan);
        } else if (!values.app) {
          checkDesktopWebBuild(repoRoot);
          const reservation = await acquireLocalResources({
            kind: "heavy",
            repoRoot,
            signal: controller.signal,
          });
          try {
            const built = await runOwnedCommand(
              "pnpm",
              ["--dir", "clients/desktop", "build"],
              {
                ...launch,
                env: { ...launch.env, [RESOURCE_TOKEN]: reservation.token },
              }
            );
            if (built !== 0) {
              throw new Error(`Desktop build failed (exit ${built}).`);
            }
          } finally {
            await reservation.release();
          }
          if (action === "prepare") {
            return;
          }
        }
        controller.signal.throwIfAborted();
        const runtime = await acquireLocalResources({
          kind: "desktop",
          repoRoot,
          signal: controller.signal,
        });
        try {
          writeDesktopRecord(repoRoot, {
            ...readDesktopRecord(repoRoot),
            pid: owner.pid,
            startedAt: owner.startedAt,
            phase: "running",
          });
          console.log(
            "Desktop GUI admitted. No heavy-build slot is retained. Stop only this GUI with pnpm desktop:stop."
          );
          process.exitCode = await runOwnedCommand(command, args, {
            ...launch,
            env: { ...launch.env, [RESOURCE_TOKEN]: runtime.token },
          });
        } finally {
          await runtime.release();
        }
      }
    );
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

async function prepareMacDesktop(lane, launch, values, signal) {
  if (!["arm64", "x64"].includes(process.arch)) {
    throw new Error("Unsupported macOS architecture.");
  }
  const plan = desktopDevelopmentPlan(lane, launch);
  checkDesktopWebBuild(repoRoot);
  const reusable =
    !values.force &&
    isDesktopBuildReusable(
      repoRoot,
      plan,
      desktopSourceIdentity(repoRoot, plan.context)
    );
  const reservation = reusable
    ? null
    : await acquireLocalResources({ kind: "heavy", repoRoot, signal });
  let build;
  try {
    build = await prepareDesktopBundle(
      repoRoot,
      plan,
      {
        ...launch,
        env: {
          ...launch.env,
          ...(reservation ? { [RESOURCE_TOKEN]: reservation.token } : {}),
        },
      },
      { force: values.force }
    );
  } finally {
    await reservation?.release();
  }
  signal.throwIfAborted();
  writeDesktopRecord(repoRoot, {
    ...readDesktopRecord(repoRoot),
    ...build,
    executable: plan.executable,
    appPath: plan.appPath,
    scheme: plan.identity.authScheme,
    phase: "prepared",
  });
  console.log(
    `Desktop ${build.reused ? "reused" : "prepared"}: ${plan.appPath}\nSource identity: ${build.sourceIdentity}\nCallback: ${plan.identity.authScheme}`
  );
  return plan;
}

function registerMacDesktop(plan) {
  // Registration is confined to our generated application's unique scheme.
  execFileSync(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", plan.appPath],
    { stdio: "pipe", timeout: 15_000 }
  );
  const receiver = inspectMacCallback(plan.identity.authScheme);
  if (!receiver || realpathSync(receiver) !== realpathSync(plan.appPath)) {
    throw new Error(
      `macOS callback receiver is ${receiver ?? "missing"}, not this app. Run pnpm desktop:doctor. No browser sign-in was started.`
    );
  }
}

function printDesktopStatus(action, json) {
  const snapshot = desktopProcessSnapshot(repoRoot);
  const result = {
    repoRoot,
    running: snapshot.running,
    phase: snapshot.running ? (snapshot.record?.phase ?? "running") : "stopped",
    pids: snapshot.processes.map((row) => row.pid),
    rssBytes: snapshot.processes.every((row) => Number.isFinite(row.rssBytes))
      ? snapshot.processes.reduce((sum, row) => sum + row.rssBytes, 0)
      : null,
    appPath: snapshot.record?.appPath ?? null,
    sourceIdentity: snapshot.record?.sourceIdentity ?? null,
    checks: [],
  };
  if (action === "doctor") {
    try {
      const lane = readCurrentIsolatedDevLane(repoRoot);
      const launch = resolveDesktopPilotLaunch({ lane });
      result.checks.push({
        name: "lane-and-cli",
        ok: true,
        webOrigin: launch.env.WEB_APP_URL,
      });
      checkDesktopWebBuild(repoRoot);
      result.checks.push({ name: "compiled-web", ok: true });
      if (process.platform === "darwin") {
        const plan = desktopDevelopmentPlan(lane, launch);
        const reusable = isDesktopBuildReusable(
          repoRoot,
          plan,
          desktopSourceIdentity(repoRoot, plan.context)
        );
        result.checks.push({
          name: "prepared-app",
          ok: reusable,
          next: reusable ? null : "pnpm desktop:prepare",
        });
        const receiver = inspectMacCallback(plan.identity.authScheme);
        result.checks.push({
          name: "callback-receiver",
          ok: receiver === plan.appPath,
          expected: plan.appPath,
          actual: receiver,
          next: "pnpm desktop:dev",
        });
      }
    } catch (error) {
      result.checks.push({
        name: "prerequisites",
        ok: false,
        message: error.message,
      });
    }
  }
  console.log(json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
  if (result.checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
