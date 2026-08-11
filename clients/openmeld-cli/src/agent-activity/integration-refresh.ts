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
