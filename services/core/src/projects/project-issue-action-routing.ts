import { listSpaceTasksResponseSchema } from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  ProjectIssueDestination,
  ResolveProjectIssueActionResponse,
} from "@openmeld/schemas/types";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { resolveSpaceStub } from "../rpc/space-ref";
import type { ProjectIssueRoutingCandidate } from "./project-repository";

// Only owner-verified Task associations select a default. Message text and
// model-proposed targets are suggestions, never evidence of human consent.
export function resolveProjectIssueAction(input: {
  projects: ProjectIssueRoutingCandidate[];
  proposedDestination: ProjectIssueDestination;
  taskProjectIds: readonly string[];
}): ResolveProjectIssueActionResponse {
  const ids = new Set(input.taskProjectIds);
  const projects = input.projects.filter((project) => ids.has(project.id));
  const project = projects.length === 1 && ids.size === 1 ? projects[0] : null;
  if (
    project?.routing.destination &&
    sameIssueDestination(project.routing.destination, input.proposedDestination)
  ) {
    return {
      basis: "project_default",
      destination: project.routing.destination,
      projectId: project.id,
      projectRevision: project.routing.revision,
    };
  }
  return {
    basis: "confirmation_required",
    destination: input.proposedDestination,
    projectId: project?.id ?? null,
    projectRevision: null,
  };
}

export function sameIssueDestination(
  a: ProjectIssueDestination,
  b: ProjectIssueDestination
): boolean {
  if (a.provider === "github" && b.provider === "github") {
    return (
      a.owner.toLowerCase() === b.owner.toLowerCase() &&
      a.repo.toLowerCase() === b.repo.toLowerCase()
    );
  }
  return (
    a.provider === "linear" &&
    b.provider === "linear" &&
    a.teamId === b.teamId &&
    a.projectId === b.projectId
  );
}

export function projectIssueRoutingDecisionForClaim(
  resolution: ResolveProjectIssueActionResponse | null
) {
  if (resolution?.basis !== "project_default") {
    return undefined;
  }
  if (resolution.projectId === null || resolution.projectRevision === null) {
    throw new Error("Project default revision is unavailable.");
  }
  return {
    projectId: resolution.projectId,
    revision: resolution.projectRevision,
    destination: resolution.destination,
  };
}

export async function readLocalIssueTaskProjects(input: {
  context: OpenMeldRequestContext;
  dispatchId: string | null;
  env: CoreBindings;
  sourceSignalId: string | null;
  sourceSpaceId: string | null;
  targetProfileId: string;
}): Promise<string[]> {
  if (!(input.dispatchId && input.sourceSignalId && input.sourceSpaceId)) {
    return [];
  }
  const stub = resolveSpaceStub(input.env.OPENMELD_SPACES, input.sourceSpaceId);
  if (!stub) {
    throw createCoreRpcHttpError({
      code: "project.issue_task_context_unavailable",
      reason: "The source Task could not be checked for this issue.",
      status: 503,
    });
  }
  const listed = listSpaceTasksResponseSchema.parse(
    await stub.rpcListTasks({
      spaceId: input.sourceSpaceId,
      spaceAccess: createDispatchContinuationSpaceAccessContext({
        dispatchId: input.dispatchId,
        requestContext: input.context,
        sourceSignalId: input.sourceSignalId,
        spaceId: input.sourceSpaceId,
        targetProfileId: input.targetProfileId,
      }),
    })
  );
  const matching = listed.tasks.filter(
    (task) => task.sourceSignalId === input.sourceSignalId
  );
  // An incomplete or ambiguous read cannot establish a default; exact-target
  // confirmation remains available without exposing other Tasks.
  return !listed.truncated && matching.length === 1
    ? (matching[0]?.projectIds ?? [])
    : [];
}
