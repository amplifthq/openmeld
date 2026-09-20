import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { execPlatformFile } from "@openmeld/adapter-core/process-launch";
import { gte, satisfies, valid } from "semver";
import { z } from "zod/v4";
import type { CommandDeps } from "./commands";
import type { ComputerToolsObservation } from "./computer-tools";
import type { ExecFileFn } from "./driver";
import { buildDesktopCommandEnv, resolveExecutableOnPath } from "./path-search";

const REGISTRY = "--registry=https://registry.npmjs.org";
const versionSchema = z.string().refine((value) => valid(value) !== null);
const releaseSchema = z.object({
  version: versionSchema,
  engines: z.object({ node: z.string().min(1) }),
});
const packageSchema = z.object({
  name: z.literal("openmeld"),
  version: versionSchema,
  bin: z.object({ openmeld: z.literal("dist/openmeld.js") }),
});

/** npm owns acquisition/integrity; a pinned external Node/JS entry owns execution. */
export async function installWindowsComputerTools(
  deps: CommandDeps,
  observation: ComputerToolsObservation = {}
): Promise<string> {
  const env = buildDesktopCommandEnv(deps.env);
  const node = resolveExecutableOnPath({ env, names: ["node.exe"] });
  const npm = resolveExecutableOnPath({ env, names: ["npm.cmd", "npm.exe"] });
  if (!(node && npm)) {
    throw new Error(
      "Install Node.js with npm on this Windows computer, then restart OpenMeld Desktop and try Connect again. Desktop does not use Electron as the background Service runtime."
    );
  }
  const run = (file: string, args: readonly string[], timeout = 30_000) =>
    new Promise<string>((resolve, reject) => {
      const exec = deps.exec ?? (execPlatformFile as ExecFileFn);
      const options = {
        env,
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      };
      exec(file, args, options, (error, stdout) =>
        error ? reject(error) : resolve(stdout.trim())
      );
    });
  const nodeVersion = valid(await run(node, ["--version"]));
  const release = releaseSchema.parse(
    JSON.parse(
      await run(npm, [
        "view",
        "openmeld@latest",
        "version",
        "engines",
        "--json",
        REGISTRY,
      ])
    )
  );
  if (!(nodeVersion && satisfies(nodeVersion, release.engines.node))) {
    throw new Error(
      `OpenMeld Tools ${release.version} requires Node.js ${release.engines.node}. Install a supported Node.js release, restart Desktop, and try Connect again.`
    );
  }
  const prefix = await run(npm, ["prefix", "--global"]);
  if (!isAbsolute(prefix)) {
    throw new Error(
      "npm did not return an absolute Windows installation directory."
    );
  }
  const root = join(prefix, "node_modules", "openmeld");
  const entry = join(root, "dist", "openmeld.js");
  const existing = await readInstalledPackage(root);
  if (existing && gte(existing.version, release.version)) {
    await assertEntry(entry);
    return entry; // Never replace a newer global CLI with the current stable channel.
  }
  reportStage(observation, "installing");
  // Freeze the version and prefix observed above. A moving npm tag or a custom
  // prefix outside PATH must not change which program the following review runs.
  await run(
    npm,
    [
      "install",
      "--global",
      "--prefix",
      prefix,
      `openmeld@${release.version}`,
      REGISTRY,
      "--no-audit",
      "--no-fund",
    ],
    5 * 60_000
  );
  reportStage(observation, "verifying");
  const installed = await readInstalledPackage(root);
  if (installed?.version !== release.version) {
    throw new Error(
      "OpenMeld Tools installation changed or did not complete. Check npm and try Connect again."
    );
  }
  await assertEntry(entry);
  const actualVersion = valid(await run(entry, ["--version"]));
  if (actualVersion !== release.version) {
    throw new Error(
      "Installed OpenMeld Tools did not report the expected version. Check the installation before connecting."
    );
  }
  return entry;
}

async function readInstalledPackage(root: string) {
  const text = await readFile(join(root, "package.json"), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  );
  return text === null ? null : packageSchema.parse(JSON.parse(text));
}

async function assertEntry(entry: string): Promise<void> {
  if (!(await stat(entry)).isFile()) {
    throw new Error("OpenMeld Tools entry is not a file.");
  }
}

function reportStage(
  observation: ComputerToolsObservation,
  stage: "installing" | "verifying"
) {
  try {
    observation.onStage?.(stage);
  } catch {
    /* UI observation never controls installation. */
  }
}
