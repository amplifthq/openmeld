import { homedir } from "node:os";
import { resolveOpenMeldRootDir } from "../config/paths";
import {
  defaultManagedIntegrationPaths,
  installAgentActivityIntegrations,
} from "./managed-integrations";
import { listProjectBindings } from "./project-bindings";
import { registerAgentActivityRoute } from "./route-registry";

export type ManagedAgentActivityIntegrationRefreshResult =
  | {
      integrations: Awaited<
        ReturnType<typeof installAgentActivityIntegrations>
      >;
      status: "ready";
    }
  | {
      reason: "no_project_bindings";
      status: "skipped";
    };

export type ManagedAgentActivityIntegrationRefreshScheduler = {
  request: () => void;
  stop: () => Promise<void>;
};

export async function refreshManagedAgentActivityIntegrations(input?: {
  homeDir?: string;
  install?: typeof installAgentActivityIntegrations;
  register?: typeof registerAgentActivityRoute;
  rootDir?: string;
}): Promise<ManagedAgentActivityIntegrationRefreshResult> {
  const rootDir = input?.rootDir ?? resolveOpenMeldRootDir();
  const bindings = await listProjectBindings({ rootDir });
  if (bindings.length === 0) {
    return { reason: "no_project_bindings", status: "skipped" };
  }
  await (input?.register ?? registerAgentActivityRoute)({ rootDir });
  return {
    integrations: await (input?.install ?? installAgentActivityIntegrations)({
      paths: defaultManagedIntegrationPaths(input?.homeDir ?? homedir()),
    }),
    status: "ready",
  };
}

export function createManagedAgentActivityIntegrationRefreshScheduler(input: {
  onError?: (error: unknown) => void;
  onResult?: (result: ManagedAgentActivityIntegrationRefreshResult) => void;
  refresh?: () => Promise<ManagedAgentActivityIntegrationRefreshResult>;
}): ManagedAgentActivityIntegrationRefreshScheduler {
  let inFlight: Promise<void> | null = null;
  let pending = false;
  let scheduled = false;
  let stopped = false;
  const refresh = input.refresh ?? refreshManagedAgentActivityIntegrations;

  const schedule = () => {
    if (stopped || scheduled) {
      return;
    }
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      run();
    });
  };
  const run = () => {
    if (stopped || inFlight || !pending) {
      return;
    }
    pending = false;
    inFlight = refresh()
      .then((result) => input.onResult?.(result))
      .catch((error) => input.onError?.(error))
      .finally(() => {
        inFlight = null;
        if (pending) {
          schedule();
        }
      });
  };

  return {
    request: () => {
      if (stopped) {
        return;
      }
      pending = true;
      schedule();
    },
    stop: async () => {
      stopped = true;
      pending = false;
      await inFlight;
    },
  };
}
