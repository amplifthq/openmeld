import { resolve } from "node:path";
import type {
  LocalProjectControlConnection,
  Project,
} from "@openmeld/schemas/types";
import { resolveOpenMeldRootDir } from "../config/paths";
import {
  emitSuccess,
  type ProjectCommandContext,
  purgeLocalProject,
  requireOption,
  requireOrganizationIdentity,
  runProjectCommand,
} from "./command";
import { assertProjectBindingProducerCompatible } from "./project-binding-producer-gate";
import { canonicalizeLocalProjectPath } from "./project-binding-resolution";
import {
  listProjectBindings,
  listProjectConnectionsWithStatus,
  removeProjectConnection,
  setDefaultProjectConnection,
} from "./project-bindings";
import { unregisterAgentActivityRoute } from "./route-registry";

type ProjectConnectionsCommandInput = {
  json?: boolean;
  projectSlug: string;
  view?: string;
};

type ProjectConnectionSnapshot = LocalProjectControlConnection;

export async function runProjectsConnectionsList(
  input: ProjectConnectionsCommandInput
): Promise<void> {
  await runProjectCommand(input, "connections.list", async (context) => {
    const project = await requireActiveProject(context, input.projectSlug);
    emitSuccess(
      context,
      "projects.connections.list",
      await buildConnectionSnapshot(context, project)
    );
  });
}

export async function runProjectsConnectionsSetDefault(
  input: ProjectConnectionsCommandInput & { generation?: string }
): Promise<void> {
  await runProjectCommand(input, "connections.set_default", async (context) => {
    const project = await requireActiveProject(context, input.projectSlug);
    const targetBindingGeneration = requireOption(
      input.generation,
      "--generation"
    );
    const before = await readProjectConnections(context, project);
    const target = before.find(
      (connection) => connection.bindingGeneration === targetBindingGeneration
    );
    if (!target) {
      throw new Error(
        `Connection generation "${targetBindingGeneration}" was not found for Project "${project.slug}".`
      );
    }
    await assertProjectBindingProducerCompatible();
    await setDefaultProjectConnection({
      expectedBindingGeneration: targetBindingGeneration,
      organizationId: context.organizationId,
      projectId: project.id,
    });
    emitSuccess(context, "projects.connections.set_default", {
      ...(await buildConnectionSnapshot(context, project)),
      status: target.isDefault ? "unchanged" : "updated",
    });
  });
}

export async function runProjectsConnectionsRemove(
  input: ProjectConnectionsCommandInput & {
    generation?: string;
    path?: string;
    replacementGeneration?: string;
  }
): Promise<void> {
  await runProjectCommand(input, "connections.remove", async (context) => {
    const project = await requireActiveProject(context, input.projectSlug);
    const before = await readProjectConnections(context, project);
    const target = await resolveRemovalTarget(before, input);
    await assertProjectBindingProducerCompatible();
    await removeProjectConnection({
      expectedBindingGeneration: target.bindingGeneration,
      organizationId: context.organizationId,
      projectId: project.id,
      ...(input.replacementGeneration
        ? {
            replacementBindingGeneration: requireOption(
              input.replacementGeneration,
              "--replacement-generation"
            ),
          }
        : {}),
    });
    const snapshot = await buildConnectionSnapshot(context, project);
    if (snapshot.connections.length === 0) {
      await purgeLocalProject({
        organizationId: context.organizationId,
        projectId: project.id,
      });
      await unregisterRouteWhenUnused();
    }
    emitSuccess(context, "projects.connections.remove", {
      ...snapshot,
      status: "removed",
    });
  });
}

async function requireActiveProject(
  context: ProjectCommandContext,
  projectSlugValue: string
): Promise<Project> {
  const projectSlug = requireOption(projectSlugValue, "project-slug");
  const response = await context.projectsApi.list();
  requireOrganizationIdentity(
    context.organizationId,
    context.organizationSlug,
    response.organizationId
  );
  const project = response.projects.find(
    (candidate) => candidate.slug === projectSlug
  );
  if (!project || project.archivedAtMs !== null) {
    throw new Error(`Active Project "${projectSlug}" was not found.`);
  }
  return project;
}

async function buildConnectionSnapshot(
  context: ProjectCommandContext,
  project: Project
) {
  return {
    connections: await readProjectConnections(context, project),
    organizationId: context.organizationId,
    projectId: project.id,
    projectSlug: project.slug,
  };
}

async function readProjectConnections(
  context: ProjectCommandContext,
  project: Project
): Promise<ProjectConnectionSnapshot[]> {
  return (
    await listProjectConnectionsWithStatus({
      organizationId: context.organizationId,
    })
  )
    .filter((connection) => connection.projectId === project.id)
    .map((connection) => ({
      bindingGeneration: connection.bindingGeneration,
      isDefault: connection.isDefault,
      path: connection.repositoryPath,
      status: connection.status,
    }))
    .sort(
      (left, right) =>
        Number(right.isDefault) - Number(left.isDefault) ||
        left.path.localeCompare(right.path)
    );
}

async function resolveRemovalTarget(
  connections: readonly ProjectConnectionSnapshot[],
  input: { generation?: string; path?: string }
): Promise<ProjectConnectionSnapshot> {
  const generation = input.generation?.trim();
  const path = input.path?.trim();
  if (Boolean(generation) === Boolean(path)) {
    throw new Error("Pass exactly one of --generation or --path.");
  }
  const canonicalPath = path
    ? ((await canonicalizeLocalProjectPath(path)) ?? resolve(path))
    : null;
  const target = connections.find((connection) =>
    generation
      ? connection.bindingGeneration === generation
      : connection.path === canonicalPath
  );
  if (!target) {
    throw new Error(
      generation
        ? `Connection generation "${generation}" was not found.`
        : `Project connection path was not found: ${canonicalPath}`
    );
  }
  return target;
}

async function unregisterRouteWhenUnused(): Promise<void> {
  if ((await listProjectBindings({})).length > 0) {
    return;
  }
  await unregisterAgentActivityRoute({
    rootDir: resolveOpenMeldRootDir(),
  }).catch((error: unknown) => {
    process.stderr.write(
      `[openmeld.agent_activity.route_unregister_failed] ${error instanceof Error ? error.message : String(error)}\n`
    );
  });
}
