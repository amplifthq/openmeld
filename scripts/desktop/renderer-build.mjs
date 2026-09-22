import { totalmem } from "node:os";
import { pathToFileURL } from "node:url";
import {
  acquireLocalResources,
  RESOURCE_TOKEN,
  resourcePolicy,
} from "../dev/local-resources.mjs";
import { runOwnedCommand } from "../dev/owned-command.mjs";

const MIB = 1024 ** 2;
const HEAP_OPTION = /(?:^|\s)--max[-_]old[-_]space[-_]size(?:=|\s+)(\d+)/gu;

export function rendererBuildEnvironment(
  env = process.env,
  memoryBytes = totalmem()
) {
  const policy = resourcePolicy(env, memoryBytes);
  const machineLimit =
    Math.floor((memoryBytes - policy.headroomBytes) / MIB) - 1024;
  const reservationLimit = env.OPENMELD_LOCAL_HEAVY_GIB
    ? Math.floor(policy.costs.heavy / MIB) - 1024
    : machineLimit;
  const limit = Math.min(machineLimit, reservationLimit);
  const existing = [...(env.NODE_OPTIONS ?? "").matchAll(HEAP_OPTION)].at(
    -1
  )?.[1];
  const heap = Number(
    env.OPENMELD_DESKTOP_NODE_HEAP_MB ??
      existing ??
      Math.min(6144, Math.floor(limit / 2))
  );
  if (!Number.isSafeInteger(heap) || heap < 512 || heap > limit) {
    throw new Error(
      `Desktop Node heap must be 512..${limit} MiB within the machine and heavy-work budget. Set OPENMELD_DESKTOP_NODE_HEAP_MB and, if needed, OPENMELD_LOCAL_HEAVY_GIB.`
    );
  }
  return {
    ...env,
    NODE_OPTIONS:
      `${(env.NODE_OPTIONS ?? "").replace(HEAP_OPTION, "").trim()} --max-old-space-size=${heap}`.trim(),
    OPENMELD_LOCAL_HEAVY_GIB:
      env.OPENMELD_LOCAL_HEAVY_GIB ?? String((heap + 1024) / 1024),
  };
}

export async function buildProductionRenderer(root, env = process.env) {
  const buildEnv = rendererBuildEnvironment(env);
  const resources = await acquireLocalResources({
    kind: "heavy",
    repoRoot: root,
    env: buildEnv,
  });
  try {
    const code = await runOwnedCommand(
      "pnpm",
      ["--dir", "clients/web", "run", "build:prod"],
      {
        cwd: root,
        env: {
          ...buildEnv,
          [RESOURCE_TOKEN]: resources.token,
          OPENMELD_DESKTOP_TARGET: "production",
        },
      }
    );
    if (code !== 0) {
      throw new Error(`Desktop production renderer build failed (${code}).`);
    }
  } finally {
    await resources.release();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await buildProductionRenderer(process.cwd());
}
