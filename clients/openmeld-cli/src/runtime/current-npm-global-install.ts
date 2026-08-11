import { realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type NpmCommandSpec = {
  command: string;
  argsPrefix: string[];
};

export type CurrentNpmGlobalPackageInstall = {
  cliScriptPath: string;
  globalPrefixPath: string;
  packageRootPath: string;
};

export async function resolveCurrentNpmCommandSpec(
  input: { nodeExecutablePath?: string; platform?: NodeJS.Platform } = {}
): Promise<NpmCommandSpec> {
  const nodeExecutablePath = input.nodeExecutablePath ?? process.execPath;
  const platform = input.platform ?? process.platform;
  const nodeExecutableDir = dirname(nodeExecutablePath);
  const npmWrapperPath = join(
    nodeExecutableDir,
    platform === "win32" ? "npm.cmd" : "npm"
  );
  if (await pathExists(npmWrapperPath)) {
    return {
      command: npmWrapperPath,
      argsPrefix: [],
    };
  }

  for (const candidate of resolveNpmCliScriptCandidates({
    nodeExecutableDir,
    platform,
  })) {
    if (await pathExists(candidate)) {
      return {
        command: nodeExecutablePath,
        argsPrefix: [candidate],
      };
    }
  }

  throw new Error(
    `OpenMeld could not locate npm for the current CLI runtime at ${nodeExecutablePath}.`
  );
}

export async function resolveCurrentNpmGlobalPackageInstall(input: {
  packageName: string;
  cliScriptPath?: string;
}): Promise<CurrentNpmGlobalPackageInstall | null> {
  const cliScriptPath = await resolveCurrentCliScriptPath(input.cliScriptPath);
  if (!cliScriptPath) {
    return null;
  }

  const packageRootPath = dirname(dirname(cliScriptPath));
  if (basename(packageRootPath) !== input.packageName) {
    return null;
  }

  const globalNodeModulesRootPath = dirname(packageRootPath);
  if (basename(globalNodeModulesRootPath) !== "node_modules") {
    return null;
  }

  const nodeModulesParentPath = dirname(globalNodeModulesRootPath);
  const globalPrefixPath =
    basename(nodeModulesParentPath) === "lib"
      ? dirname(nodeModulesParentPath)
      : nodeModulesParentPath;

  return {
    cliScriptPath,
    globalPrefixPath,
    packageRootPath,
  };
}

async function resolveCurrentCliScriptPath(
  cliScriptPath?: string
): Promise<string | null> {
  const rawCliScriptPath = cliScriptPath ?? process.argv[1];
  if (!rawCliScriptPath) {
    return null;
  }

  const resolvedCliScriptPath = await realpath(rawCliScriptPath).catch(() => {
    return rawCliScriptPath;
  });

  return normalizePathForComparison(resolvedCliScriptPath).endsWith(
    "/dist/openmeld.js"
  )
    ? resolvedCliScriptPath
    : null;
}

function resolveNpmCliScriptCandidates(input: {
  nodeExecutableDir: string;
  platform: NodeJS.Platform;
}): string[] {
  if (input.platform === "win32") {
    return [
      join(input.nodeExecutableDir, "node_modules", "npm", "bin", "npm-cli.js"),
    ];
  }

  return [
    join(
      input.nodeExecutableDir,
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js"
    ),
  ];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function normalizePathForComparison(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}
