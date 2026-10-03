import {
  acquireLocalResources,
  RESOURCE_TOKEN,
  resourcePolicy,
} from "../dev/local-resources.mjs";
import { readMachineMemory } from "../dev/machine-memory.mjs";
import { runOwnedCommand } from "../dev/owned-command.mjs";

const MIB = 1024 ** 2;
const HEAP_OPTION = /(?:^|\s)--max[-_]old[-_]space[-_]size(?:=|\s+)(\d+)/gu;

export function rendererBuildEnvironment(
  env = process.env,
  memoryBytes = readMachineMemory().totalBytes,
  platform = process.platform,
  defaultHeapMiB = 4096
) {
  const policy = resourcePolicy(env, memoryBytes, platform);
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
    env.OPENMELD_RENDERER_NODE_HEAP_MB ?? existing ?? defaultHeapMiB
  );
  if (
    !Number.isSafeInteger(heap) ||
    heap < 512 ||
    heap > limit ||
    (env.OPENMELD_LOCAL_HEAVY_GIB &&
      policy.costs.heavy + policy.headroomBytes > memoryBytes)
  ) {
    throw new Error(
      `Renderer Node heap must be 512..${limit} MiB within the machine and heavy-work budget. Set OPENMELD_RENDERER_NODE_HEAP_MB and, if needed, OPENMELD_LOCAL_HEAVY_GIB.`
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

export async function buildProductionRenderer(
  root,
  env = process.env,
  options = {}
) {
  const memory = (options.readMemory ?? readMachineMemory)();
  const buildEnv = rendererBuildEnvironment(env, memory.totalBytes);
  const policy = resourcePolicy(buildEnv, memory.totalBytes);
  console.log(
    `[renderer-build] ${JSON.stringify({
      ...memory,
      heapMiB: Number(
        [...buildEnv.NODE_OPTIONS.matchAll(HEAP_OPTION)].at(-1)[1]
      ),
      heavyBudgetBytes: policy.costs.heavy,
      headroomBytes: policy.headroomBytes,
    })}`
  );
  // Hosted Actions jobs run on isolated runners; the worktree resource queue
  // only coordinates concurrent builds on a shared development machine.
  const resources =
    env.GITHUB_ACTIONS === "true"
      ? undefined
      : await (options.acquireResources ?? acquireLocalResources)({
          kind: "heavy",
          repoRoot: root,
          env: buildEnv,
        });
  try {
    const code = await (options.runCommand ?? runOwnedCommand)(
      "pnpm",
      ["--dir", options.clientDirectory ?? "clients/web", "run", "build:prod"],
      {
        cwd: root,
        env: {
          ...buildEnv,
          ...(resources ? { [RESOURCE_TOKEN]: resources.token } : {}),
        },
      }
    );
    if (code !== 0) {
      throw new Error(`Production client renderer build failed (${code}).`);
    }
  } finally {
    await resources?.release();
  }
}
