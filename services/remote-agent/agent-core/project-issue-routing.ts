import {
  isLinearIssueCreateAction,
  projectIssueDestinationSchema,
  resolveProjectIssueActionResponseSchema,
} from "@openmeld/schemas";
import type {
  ProjectIssueDestination,
  ResolveProjectIssueActionResponse,
} from "@openmeld/schemas/types";
import type { RemoteAgentCoreWorkerBinding } from "./callback-context";
import { callCoreRpc } from "./core-rpc";
import type { buildRemoteAgentToolContext } from "./tool-context";

export async function requireProjectIssueActionDestination(input: {
  coreWorker: RemoteAgentCoreWorkerBinding;
  destination: ProjectIssueDestination;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}) {
  const destination = projectIssueDestinationSchema.parse(input.destination);
  const response = await callCoreRpc(
    input.coreWorker,
    "resolveProjectIssueAction",
    {
      context: input.toolContext.context,
      proposedDestination: destination,
    },
    (binding, request) => binding.resolveProjectIssueAction?.(request)
  );
  const resolved = resolveProjectIssueActionResponseSchema.parse(response);
  if (!sameIssueDestination(destination, resolved.destination)) {
    throw new Error(
      "project.issue_destination_mismatch: The resolved issue target differs from the provider action input."
    );
  }
  if (
    resolved.basis === "project_default" &&
    (resolved.projectId === null || resolved.projectRevision === null)
  ) {
    throw new Error("project.issue_default_revision_unavailable");
  }
  return resolved;
}

function sameIssueDestination(
  proposed: ProjectIssueDestination,
  resolved: ProjectIssueDestination
): boolean {
  if (proposed.provider !== resolved.provider) {
    return false;
  }
  if (proposed.provider === "github" && resolved.provider === "github") {
    return (
      proposed.owner.toLowerCase() === resolved.owner.toLowerCase() &&
      proposed.repo.toLowerCase() === resolved.repo.toLowerCase()
    );
  }
  return (
    proposed.provider === "linear" &&
    resolved.provider === "linear" &&
    proposed.teamId === resolved.teamId &&
    proposed.projectId === resolved.projectId
  );
}

export function issueRoutingDecisionForClaim(
  resolved: ResolveProjectIssueActionResponse | null
) {
  if (resolved?.basis !== "project_default") {
    return undefined;
  }
  if (resolved.projectId === null || resolved.projectRevision === null) {
    throw new Error("project.issue_default_revision_unavailable");
  }
  return {
    projectId: resolved.projectId,
    revision: resolved.projectRevision,
    destination: resolved.destination,
  };
}

export function readGitHubIssueDestination(
  actionInput: Record<string, unknown>
): ProjectIssueDestination {
  return projectIssueDestinationSchema.parse({
    provider: "github",
    owner: actionInput.owner,
    repo: actionInput.repo,
  });
}

export function readLinearIssueDestination(input: {
  actionId: string;
  actionInput: Record<string, unknown>;
  service: string;
}): ProjectIssueDestination | null {
  if (
    input.service !== "linear" ||
    !isLinearIssueCreateAction(input.actionId)
  ) {
    return null;
  }
  return projectIssueDestinationSchema.parse({
    provider: "linear",
    teamId: input.actionInput.teamId,
    ...(input.actionInput.projectId === undefined
      ? {}
      : { projectId: input.actionInput.projectId }),
  });
}
