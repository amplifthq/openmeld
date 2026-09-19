import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { desktopAuthIdentity } from "../../packages/schemas/src/desktop-auth-identity.ts";
import { desktopDevelopmentContextSchema } from "../../packages/schemas/src/desktop-development.ts";
import { desktopWebBuildIdentity } from "../desktop/web-build-identity.mjs";
import { runOwnedCommand } from "./owned-command.mjs";

export function desktopDevelopmentPlan(lane, launch, arch = process.arch) {
  const context = desktopDevelopmentContextSchema.parse({
    version: 1,
    repoRoot: lane.repoRoot,
    laneId: lane.laneId,
    openMeldHome: lane.openMeldHome,
    preset: launch.env.OPENMELD_ENV_PRESET,
    webOrigin: launch.env.WEB_APP_URL,
    authOrigin: launch.env.OPENMELD_AUTH_URL,
    gatewayOrigin: launch.env.OPENMELD_GATEWAY_URL,
  });
  const identity = desktopAuthIdentity(false, undefined, context.webOrigin);
  const name = `OpenMeld Dev ${lane.laneId}`;
  const appPath = join(
    lane.repoRoot,
    "clients/desktop/dist/development",
    arch === "arm64" ? "mac-arm64" : "mac",
    `${name}.app`
  );
  return {
    context,
    identity,
    appPath,
    executable: join(appPath, "Contents/MacOS", name),
  };
}

export function desktopSourceIdentity(root, context) {
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "clients/desktop",
      "scripts/dev",
      "scripts/desktop",
      "package.json",
      "pnpm-lock.yaml",
      ".nvmrc",
    ],
    { cwd: root, encoding: "utf8" }
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256")
    .update(desktopWebBuildIdentity(root))
    .update(JSON.stringify(context))
    .update(process.arch)
    .update(process.version);
  for (const file of new Set(files)) {
    try {
      hash
        .update(file)
        .update("\0")
        .update(readFileSync(join(root, file)))
        .update("\0");
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return hash.digest("hex");
}

/** Cheap prerequisites; the normal asset validator still runs before packaging. */
export function checkDesktopWebBuild(root) {
  const webBuild = desktopWebBuildIdentity(root);
  try {
    const marker = JSON.parse(
      readFileSync(
        join(root, "clients/web/dist/client/desktop-build.json"),
        "utf8"
      )
    );
    if (
      marker.webBuild !== webBuild ||
      marker.installedTarget ||
      !readFileSync(
        join(root, "clients/web/dist/client/_shell.html"),
        "utf8"
      ).trim() ||
      !statSync(join(root, "clients/web/dist/client/assets")).isDirectory()
    ) {
      throw new Error("stale");
    }
  } catch {
    throw new Error(
      "Matching compiled Web pages are missing or stale. Run pnpm desktop:web in this worktree, then retry. For UI-only hot reload use pnpm dev:web:worktree instead; do not mix its dev output with native smoke."
    );
  }
  return webBuild;
}

export function inspectMacCallback(scheme) {
  const script = `ObjC.import('AppKit'); function run(argv) { var u=$.NSURL.URLWithString(argv[0]+'://auth/callback'); var a=$.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(u); return JSON.stringify({path:a?ObjC.unwrap(a.path):null}); }`;
  return JSON.parse(
    execFileSync("osascript", ["-l", "JavaScript", "-e", script, scheme], {
      encoding: "utf8",
      timeout: 10_000,
    })
  ).path;
}

export function verifyDesktopBundle(plan) {
  const info = JSON.parse(
    execFileSync(
      "plutil",
      [
        "-convert",
        "json",
        "-o",
        "-",
        join(plan.appPath, "Contents/Info.plist"),
      ],
      { encoding: "utf8", timeout: 10_000 }
    )
  );
  const schemes =
    info.CFBundleURLTypes?.flatMap((item) => item.CFBundleURLSchemes ?? []) ??
    [];
  if (
    info.CFBundleIdentifier !== plan.identity.authScheme ||
    !schemes.includes(plan.identity.authScheme) ||
    !existsSync(plan.executable)
  ) {
    throw new Error(
      "Development bundle does not declare this worktree's exact callback identity."
    );
  }
  execFileSync("codesign", ["--verify", "--deep", "--strict", plan.appPath], {
    stdio: "pipe",
    timeout: 30_000,
  });
}

export function isDesktopBuildReusable(
  root,
  plan,
  sourceIdentity,
  verify = verifyDesktopBundle
) {
  try {
    const receipt = JSON.parse(
      readFileSync(join(root, ".turbo/dev/desktop-build.json"), "utf8")
    );
    if (
      receipt.version !== 1 ||
      receipt.sourceIdentity !== sourceIdentity ||
      receipt.appPath !== plan.appPath
    ) {
      return false;
    }
    verify(plan);
    return true;
  } catch {
    return false;
  }
}

export async function prepareDesktopBundle(
  root,
  plan,
  launch,
  { force = false } = {}
) {
  const webBuild = checkDesktopWebBuild(root);
  const sourceIdentity = desktopSourceIdentity(root, plan.context);
  if (!force && isDesktopBuildReusable(root, plan, sourceIdentity)) {
    return { reused: true, sourceIdentity, webBuild };
  }
  const env = {
    ...launch.env,
    OPENMELD_DESKTOP_PRIVATE_PACKAGE: "1",
    OPENMELD_DESKTOP_DEVELOPMENT_CONTEXT: JSON.stringify(plan.context),
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  };
  // A dev command cannot inherit installed/release signing or target selection.
  for (const key of [
    "OPENMELD_DESKTOP_TARGET",
    "OPENMELD_DESKTOP_ACCEPTANCE",
    "OPENMELD_DESKTOP_PRODUCTION_PREVIEW",
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
  ]) {
    delete env[key];
  }
  const run = async (args) => {
    const code = await runOwnedCommand("pnpm", args, { cwd: root, env });
    if (code !== 0) {
      throw new Error(
        `Desktop preparation failed (exit ${code}). The previous receipt is not promoted.`
      );
    }
    if (desktopSourceIdentity(root, plan.context) !== sourceIdentity) {
      throw new Error(
        "Source changed during Desktop preparation. Finish editing, then retry."
      );
    }
  };
  await run(["--dir", "clients/desktop", "build:contract-deps"]);
  const { stageDesktopRenderer } = await import(
    "../desktop/private-package.mjs"
  );
  stageDesktopRenderer(root);
  await run(["--dir", "clients/desktop", "icons:generate"]);
  await run(["--dir", "clients/desktop", "exec", "electron-vite", "build"]);
  await run([
    "--dir",
    "clients/desktop",
    "exec",
    "electron-builder",
    "--config",
    "electron-builder.development.config.mjs",
    "--dir",
    "--mac",
    `--${process.arch}`,
    "--publish",
    "never",
  ]);
  verifyDesktopBundle(plan);
  if (desktopSourceIdentity(root, plan.context) !== sourceIdentity) {
    throw new Error(
      "Source changed during bundle verification. Retry preparation."
    );
  }
  const file = join(root, ".turbo/dev/desktop-build.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    `${file}.tmp`,
    `${JSON.stringify({ version: 1, sourceIdentity, webBuild, appPath: plan.appPath })}\n`,
    { mode: 0o600 }
  );
  renameSync(`${file}.tmp`, file);
  return { reused: false, sourceIdentity, webBuild };
}
