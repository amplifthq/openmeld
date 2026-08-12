import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse, resolve } from "node:path";
import type { RuntimeAgentControllerLaunchContract } from "@openmeld/adapter-core";
import { buildCliLaunchInvocation } from "@openmeld/adapter-core";

type CodexPlatformLayout = {
  packageName: string;
  targetTriple: string;
};

type CodexPackageJson = {
  bin?: string | Record<string, string>;
  name?: string;
};

type CodexAppServerLaunch = {
  args: string[];
  bin: string;
  env: Record<string, string | undefined>;
  processLaunchKind: "native_binary" | "package_entrypoint";
  shell?: boolean;
};

const CODEX_PLATFORM_LAYOUTS: Record<string, CodexPlatformLayout> = {
  "darwin-arm64": {
    packageName: "@openai/codex-darwin-arm64",
    targetTriple: "aarch64-apple-darwin",
  },
  "darwin-x64": {
    packageName: "@openai/codex-darwin-x64",
    targetTriple: "x86_64-apple-darwin",
  },
  "linux-arm64": {
    packageName: "@openai/codex-linux-arm64",
    targetTriple: "aarch64-unknown-linux-musl",
  },
  "linux-x64": {
    packageName: "@openai/codex-linux-x64",
    targetTriple: "x86_64-unknown-linux-musl",
  },
  "win32-arm64": {
    packageName: "@openai/codex-win32-arm64",
    targetTriple: "aarch64-pc-windows-msvc",
  },
  "win32-x64": {
    packageName: "@openai/codex-win32-x64",
    targetTriple: "x86_64-pc-windows-msvc",
  },
};
const BUN_USER_AGENT_RE = /\bbun\//;
const CODEX_MANAGED_ENV_NAMES = new Set([
  "CODEX_MANAGED_BY_BUN",
  "CODEX_MANAGED_BY_NPM",
  "CODEX_MANAGED_BY_PNPM",
]);

export function buildCodexAppServerLaunch(input: {
  args: string[];
  env: Record<string, string | undefined>;
  launchContract: RuntimeAgentControllerLaunchContract;
}): CodexAppServerLaunch {
  const nativeRuntime = resolveOfficialCodexNativeRuntime(input.launchContract);
  if (!nativeRuntime || input.launchContract.kind !== "node_script") {
    const invocation = buildCliLaunchInvocation({
      args: input.args,
      launchContract: input.launchContract,
    });
    return {
      ...invocation,
      env: input.env,
      processLaunchKind: "package_entrypoint",
    };
  }

  return {
    args: [...(input.launchContract.argsPrefix ?? []), ...input.args],
    bin: nativeRuntime.executablePath,
    env: buildOfficialCodexRuntimeEnv({
      env: input.env,
      packageRoot: nativeRuntime.packageRoot,
      scriptPath: input.launchContract.scriptPath,
    }),
    processLaunchKind: "native_binary",
  };
}

function resolveOfficialCodexNativeRuntime(
  launchContract: RuntimeAgentControllerLaunchContract
): { executablePath: string; packageRoot: string } | null {
  if (launchContract.kind !== "node_script") {
    return null;
  }

  const layout = CODEX_PLATFORM_LAYOUTS[`${process.platform}-${process.arch}`];
  if (!layout) {
    return null;
  }

  try {
    const scriptPath = realpathSync(launchContract.scriptPath);
    const packageRoot = findOfficialCodexPackageRoot(scriptPath);
    if (!packageRoot) {
      return null;
    }

    const require = createRequire(scriptPath);
    const platformPackageRoot = resolvePlatformPackageRoot({
      packageName: layout.packageName,
      require,
    });
    const vendorRoot = platformPackageRoot
      ? join(platformPackageRoot, "vendor")
      : join(packageRoot, "vendor");
    const executablePath = join(
      vendorRoot,
      layout.targetTriple,
      "bin",
      process.platform === "win32" ? "codex.exe" : "codex"
    );
    accessSync(executablePath, constants.F_OK);
    accessSync(executablePath, constants.X_OK);

    return {
      executablePath: realpathSync(executablePath),
      packageRoot,
    };
  } catch {
    // Unknown or newer package layouts keep using the official entry point.
    // Direct execution is selected only when OpenMeld can prove the exact
    // packaged native runtime that the official wrapper would launch.
    return null;
  }
}

function findOfficialCodexPackageRoot(scriptPath: string): string | null {
  let current = dirname(scriptPath);
  const filesystemRoot = parse(current).root;
  for (let depth = 0; depth < 4 && current !== filesystemRoot; depth += 1) {
    const packageJsonPath = join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = readPackageJson(packageJsonPath);
      const binPath = readCodexBinPath(packageJson);
      if (
        packageJson.name === "@openai/codex" &&
        binPath &&
        realpathSync(resolve(current, binPath)) === scriptPath
      ) {
        return realpathSync(current);
      }
    }
    current = dirname(current);
  }
  return null;
}

function resolvePlatformPackageRoot(input: {
  packageName: string;
  require: NodeJS.Require;
}): string | null {
  try {
    const packageJsonPath = input.require.resolve(
      `${input.packageName}/package.json`
    );
    const packageJson = readPackageJson(packageJsonPath);
    return packageJson.name === "@openai/codex" ||
      packageJson.name === input.packageName
      ? realpathSync(dirname(packageJsonPath))
      : null;
  } catch {
    return null;
  }
}

function readPackageJson(packageJsonPath: string): CodexPackageJson {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as CodexPackageJson;
}

function readCodexBinPath(packageJson: CodexPackageJson): string | null {
  if (typeof packageJson.bin === "string") {
    return packageJson.bin;
  }
  const binPath = packageJson.bin?.codex;
  return typeof binPath === "string" ? binPath : null;
}

function buildOfficialCodexRuntimeEnv(input: {
  env: Record<string, string | undefined>;
  packageRoot: string;
  scriptPath: string;
}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...Object.fromEntries(
      Object.entries(input.env).filter(
        ([name]) => !CODEX_MANAGED_ENV_NAMES.has(name)
      )
    ),
    CODEX_MANAGED_PACKAGE_ROOT: input.packageRoot,
  };
  env[
    resolveManagedByEnvName({
      env,
      packageRoot: input.packageRoot,
      scriptPath: input.scriptPath,
    })
  ] = "1";
  return env;
}

function resolveManagedByEnvName(input: {
  env: Record<string, string | undefined>;
  packageRoot: string;
  scriptPath: string;
}): "CODEX_MANAGED_BY_BUN" | "CODEX_MANAGED_BY_NPM" | "CODEX_MANAGED_BY_PNPM" {
  if (
    input.packageRoot.includes(".bun/install/global") ||
    input.packageRoot.includes(".bun\\install\\global") ||
    BUN_USER_AGENT_RE.test(input.env.npm_config_user_agent ?? "") ||
    (input.env.npm_execpath ?? "").includes("bun")
  ) {
    return "CODEX_MANAGED_BY_BUN";
  }

  if (
    input.packageRoot.includes(`${join("node_modules", ".pnpm")}`) ||
    input.scriptPath.includes(`${join("node_modules", ".pnpm")}`)
  ) {
    return "CODEX_MANAGED_BY_PNPM";
  }

  return "CODEX_MANAGED_BY_NPM";
}
