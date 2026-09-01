import path from "node:path";
import type { Alias } from "vite";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

function workspaceSource(relativePath: string): string {
  return path.resolve(workspaceRoot, relativePath);
}

/**
 * Keep focused CLI tests runnable from a fresh worktree. Workspace packages
 * publish `dist`, but Vitest exercises their current source and must not depend
 * on a separate package build happening first.
 */
export const OPENMELD_CLI_VITEST_WORKSPACE_ALIASES: Alias[] = [
  {
    find: /^@openmeld\/adapter-core\/drivers\/cli-driver$/,
    replacement: workspaceSource(
      "runtime/adapters/core/src/drivers/cli-driver.ts"
    ),
  },
  {
    find: /^@openmeld\/schemas\/schemas$/,
    replacement: workspaceSource("packages/schemas/src/schemas/index.ts"),
  },
  {
    find: /^@openmeld\/schemas\/testing$/,
    replacement: workspaceSource(
      "packages/schemas/src/testing/space-members.ts"
    ),
  },
  {
    find: /^@openmeld\/schemas$/,
    replacement: workspaceSource("packages/schemas/src/index.ts"),
  },
  ...[
    ["adapter-claude-code", "runtime/adapters/claude-code/src/index.ts"],
    ["adapter-codex", "runtime/adapters/codex/src/index.ts"],
    ["adapter-core", "runtime/adapters/core/src/index.ts"],
    ["adapter-cursor", "runtime/adapters/cursor/src/index.ts"],
    ["adapter-grok-build", "runtime/adapters/grok-build/src/index.ts"],
    ["adapter-openclaw", "runtime/adapters/openclaw/src/index.ts"],
    ["adapter-opencode", "runtime/adapters/opencode/src/index.ts"],
    ["agent-runtime", "packages/agent-runtime/src/index.ts"],
    ["api-client", "packages/api-client/src/index.ts"],
    ["gateway-contract", "packages/gateway-contract/src/index.ts"],
    ["local-execution", "runtime/local-execution/src/index.ts"],
    ["local-service", "runtime/local-service/src/index.ts"],
    ["projects", "packages/projects/src/index.ts"],
    ["protocol", "packages/protocol/src/index.ts"],
    ["routine-schedule", "packages/routine-schedule/src/index.ts"],
    ["space", "packages/space/src/index.ts"],
    ["space-mesh", "packages/space-mesh/src/index.ts"],
    ["start", "packages/start/src/index.ts"],
    ["utils", "packages/utils/src/index.ts"],
  ].map(([packageName, relativePath]) => ({
    find: new RegExp(`^@openmeld/${packageName}$`),
    replacement: workspaceSource(relativePath),
  })),
];
