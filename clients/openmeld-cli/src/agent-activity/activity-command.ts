import { homedir } from "node:os";
import {
  agentActivityProviderSchema,
  cliJsonOutputEnvelopeSchema,
} from "@openmeld/schemas";
import type { AgentActivityProvider } from "@openmeld/schemas/types";
import { resolveOpenMeldRootDir } from "../config/paths";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import { renderTextInfoCard } from "../ui/info-card";
import { readControllerTaskLifecycleOutboxHealth } from "./controller-task-lifecycle-store";
import {
  AgentControllerTaskLifecycleDurabilityError,
  ingestAgentActivityHook,
  readAgentActivityHookStdin,
} from "./hook-ingest";
import { readAgentActivityContextForPath } from "./local-context-cache";
import { readAgentActivityOutboxHealth } from "./local-event-store";
import { syncLocalAgentActivity } from "./local-sync";
import {
  AGENT_ACTIVITY_INTEGRATION_OWNER,
  defaultManagedIntegrationPaths,
  installAgentActivityIntegrations,
  readAgentActivityIntegrationStatus,
  uninstallAgentActivityIntegrations,
} from "./managed-integrations";
import {
  isAgentActivityRouteRegistered,
  registerAgentActivityRoute,
  resolveAgentActivityRouteForPath,
  unregisterAgentActivityRoute,
} from "./route-registry";

type OutputOptions = { json?: boolean };

export async function runActivityInstall(input: OutputOptions) {
  await registerAgentActivityRoute({ rootDir: resolveOpenMeldRootDir() });
  const integrations = await installAgentActivityIntegrations({
    paths: defaultManagedIntegrationPaths(homedir()),
  });
  emit(input, "activity.install", { integrations });
}

export async function runActivityUninstall(input: OutputOptions) {
  let removedIntegrations:
    | Awaited<ReturnType<typeof uninstallAgentActivityIntegrations>>
    | undefined;
  const routeRemoval = await unregisterAgentActivityRoute({
    onNoRemainingRoutes: async () => {
      removedIntegrations = await uninstallAgentActivityIntegrations({
        paths: defaultManagedIntegrationPaths(homedir()),
      });
    },
    rootDir: resolveOpenMeldRootDir(),
  });
  const integrations =
    routeRemoval.remainingRouteCount === 0
      ? requireRemovedIntegrationResults(removedIntegrations)
      : await retainedIntegrationResults();
  emit(input, "activity.uninstall", { integrations });
}

function requireRemovedIntegrationResults(
  value:
    | Awaited<ReturnType<typeof uninstallAgentActivityIntegrations>>
    | undefined
) {
  if (!value) {
    throw new Error(
      "Agent Activity integrations were not removed with the final route."
    );
  }
  return value;
}

export async function runActivityStatus(input: OutputOptions) {
  const [health, controllerTaskHealth, installedIntegrations, routeRegistered] =
    await Promise.all([
      readAgentActivityOutboxHealth({}),
      readControllerTaskLifecycleOutboxHealth({}),
      readAgentActivityIntegrationStatus(
        defaultManagedIntegrationPaths(homedir())
      ),
      isAgentActivityRouteRegistered({ rootDir: resolveOpenMeldRootDir() }),
    ]);
  const integrations = {
    claude: installedIntegrations.claude && routeRegistered,
    codex: installedIntegrations.codex && routeRegistered,
    cursor: installedIntegrations.cursor && routeRegistered,
    openCode: installedIntegrations.openCode && routeRegistered,
  };
  if (!input.json) {
    emitActivityHealthCard({
      controllerTaskHealth,
      health,
      integrations,
      title: "Agent Activity Status",
    });
    return;
  }
  emit(input, "activity.status", {
    controllerTaskHealth,
    health,
    integrations,
  });
}

export async function runActivityHealth(input: OutputOptions) {
  const [health, controllerTaskHealth] = await Promise.all([
    readAgentActivityOutboxHealth({}),
    readControllerTaskLifecycleOutboxHealth({}),
  ]);
  if (!input.json) {
    emitActivityHealthCard({
      controllerTaskHealth,
      health,
      title: "Agent Activity Health",
    });
    return;
  }
  emit(input, "activity.health", { controllerTaskHealth, health });
}

export async function runActivitySync(input: OutputOptions) {
  emit(input, "activity.sync", { result: await syncLocalAgentActivity() });
}

export async function runActivityContext(
  input: OutputOptions & { path?: string }
) {
  const context = await readRoutedAgentActivityContextForPath({
    path: input.path ?? process.cwd(),
  });
  if (input.json) {
    emitCliJsonEnvelope(
      cliJsonOutputEnvelopeSchema.parse({
        context,
        schemaVersion: 1,
        type: "activity.context",
      })
    );
    return;
  }
  process.stdout.write(
    context ? `${context}\n` : "No fresh Agent Activity context is available.\n"
  );
}

export async function runActivityHook(input: {
  owner?: string;
  provider?: string;
}) {
  if (input.owner !== AGENT_ACTIVITY_INTEGRATION_OWNER) {
    throw new Error("Unrecognized Agent Activity hook owner.");
  }
  if (!isProvider(input.provider)) {
    throw new Error("Unsupported Agent Activity hook provider.");
  }
  const payload = await readAgentActivityHookStdin();
  await ingestRoutedAgentActivityHook({
    payload,
    provider: input.provider,
  }).catch((error: unknown) => {
    reportHookFailure("ingest");
    if (error instanceof AgentControllerTaskLifecycleDurabilityError) {
      throw error;
    }
  });
  if (
    isRecord(payload) &&
    (payload.hook_event_name === "SessionStart" ||
      payload.hook_event_name === "sessionStart")
  ) {
    const context = readPayloadCwd(payload)
      ? await readRoutedAgentActivityContextForPath({
          path: readPayloadCwd(payload) as string,
        }).catch(() => {
          reportHookFailure("context_read");
          return null;
        })
      : null;
    const output = buildAgentActivityHookContextOutput(
      payload,
      context,
      input.provider
    );
    if (output) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
  }
}

export async function ingestRoutedAgentActivityHook(input: {
  globalRootDir?: string;
  nowMs?: number;
  payload: unknown;
  provider: AgentActivityProvider;
}) {
  const cwd = readPayloadCwd(input.payload);
  if (!cwd) {
    return "ignored" as const;
  }
  const route = await resolveAgentActivityRouteForPath({
    globalRootDir: input.globalRootDir,
    path: cwd,
  });
  if (!route) {
    return "unbound" as const;
  }
  return await ingestAgentActivityHook({
    nowMs: input.nowMs,
    payload: input.payload,
    provider: input.provider,
    rootDir: route.rootDir,
  });
}

export async function readRoutedAgentActivityContextForPath(input: {
  globalRootDir?: string;
  nowMs?: number;
  path: string;
}) {
  const route = await resolveAgentActivityRouteForPath(input);
  return route
    ? await readAgentActivityContextForPath({
        nowMs: input.nowMs,
        path: input.path,
        rootDir: route.rootDir,
      })
    : null;
}

function reportHookFailure(stage: "context_read" | "ingest") {
  process.stderr.write(`[openmeld.agent_activity.${stage}_failed]\n`);
}

async function retainedIntegrationResults() {
  const status = await readAgentActivityIntegrationStatus(
    defaultManagedIntegrationPaths(homedir())
  );
  return {
    claude: status.claude ? ("reused" as const) : ("missing" as const),
    codex: status.codex ? ("reused" as const) : ("missing" as const),
    cursor: status.cursor ? ("reused" as const) : ("missing" as const),
    openCode: status.openCode ? ("reused" as const) : ("missing" as const),
  };
}

export function buildAgentActivityHookContextOutput(
  payload: unknown,
  context: string | null,
  provider: AgentActivityProvider = "claude-code"
) {
  if (
    !(
      isRecord(payload) &&
      (payload.hook_event_name === "SessionStart" ||
        payload.hook_event_name === "sessionStart") &&
      context
    )
  ) {
    return null;
  }
  if (provider === "cursor") {
    return { additional_context: context };
  }
  return {
    hookSpecificOutput: {
      additionalContext: context,
      hookEventName: "SessionStart" as const,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPayloadCwd(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  if (typeof payload.cwd === "string" && payload.cwd.trim()) {
    return payload.cwd.trim();
  }
  if (!Array.isArray(payload.workspace_roots)) {
    return null;
  }
  const roots = payload.workspace_roots.filter(
    (value): value is string =>
      typeof value === "string" && Boolean(value.trim())
  );
  return roots.length === 1 ? (roots[0]?.trim() ?? null) : null;
}

function isProvider(value: string | undefined): value is AgentActivityProvider {
  return agentActivityProviderSchema.safeParse(value).success;
}

function emit(
  input: OutputOptions,
  type: string,
  payload: Record<string, unknown>
) {
  if (input.json) {
    emitCliJsonEnvelope(
      cliJsonOutputEnvelopeSchema.parse({
        schemaVersion: 1,
        type,
        ...payload,
      })
    );
    return;
  }
  process.stdout.write(`${humanTitle(type)}\n`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function humanTitle(type: string) {
  return type
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function emitActivityHealthCard(input: {
  controllerTaskHealth: Awaited<
    ReturnType<typeof readControllerTaskLifecycleOutboxHealth>
  >;
  health: Awaited<ReturnType<typeof readAgentActivityOutboxHealth>>;
  integrations?: {
    claude: boolean;
    codex: boolean;
    cursor: boolean;
    openCode: boolean;
  };
  title: string;
}) {
  renderTextInfoCard({
    emitLine: (line) => process.stdout.write(`${line}\n`),
    rows: [
      ...(input.integrations
        ? [
            {
              label: "Observers",
              value: [
                `Claude Code ${readinessLabel(input.integrations.claude)}`,
                `Codex ${readinessLabel(input.integrations.codex)}`,
                `Cursor ${readinessLabel(input.integrations.cursor)}`,
                `OpenCode ${readinessLabel(input.integrations.openCode)}`,
              ].join(" · "),
            },
          ]
        : []),
      { label: "Pending", value: String(input.health.pending) },
      { label: "Retrying", value: String(input.health.retrying) },
      {
        label: "Recent permanent rejections",
        value: `${String(input.health.permanentlyRejected)} retained (latest 200 maximum)`,
      },
      {
        label: "Task callbacks pending",
        value: String(input.controllerTaskHealth.pending),
      },
      {
        label: "Task callbacks retrying",
        value: String(input.controllerTaskHealth.retrying),
      },
      {
        label: "Recent task callback rejections",
        value: `${String(input.controllerTaskHealth.permanentlyRejected)} retained (latest 200 maximum)`,
      },
    ],
    sanitize: true,
    title: input.title,
  });
}

function readinessLabel(ready: boolean) {
  return ready ? "ready" : "needs attention";
}
