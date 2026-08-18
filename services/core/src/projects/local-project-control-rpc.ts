import {
  localProjectControlConnectCandidateRpcInputSchema,
  localProjectControlConnectDeclaredPathRpcInputSchema,
  localProjectControlDiscoverProjectsRpcInputSchema,
  localProjectControlRemoveConnectionRpcInputSchema,
  localProjectControlRemoveMissingConnectionsRpcInputSchema,
  localProjectControlSetDefaultConnectionRpcInputSchema,
} from "@openmeld/schemas";
import type {
  LocalProjectControlConnectCandidateRpcInput,
  LocalProjectControlConnectDeclaredPathRpcInput,
  LocalProjectControlConnectOutcome,
  LocalProjectControlConnectResponse,
  LocalProjectControlDiscoverProjectsResponse,
  LocalProjectControlDiscoverProjectsRpcInput,
  LocalProjectControlErrorResponse,
  LocalProjectControlPathConflictResponse,
  LocalProjectControlRemoveConnectionResponse,
  LocalProjectControlRemoveConnectionRpcInput,
  LocalProjectControlRemoveMissingConnectionsResponse,
  LocalProjectControlRemoveMissingConnectionsRpcInput,
  LocalProjectControlSetDefaultConnectionResponse,
  LocalProjectControlSetDefaultConnectionRpcInput,
  Project,
} from "@openmeld/schemas/types";
import {
  connectRuntimeTransportProjectCandidate,
  connectRuntimeTransportProjectDeclaredPath,
  discoverRuntimeTransportProjects,
  removeRuntimeTransportMissingProjectConnections,
  removeRuntimeTransportProjectConnection,
  setRuntimeTransportDefaultProjectConnection,
} from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { prepareExpectedHumanProjectRequest } from "./project-request-preparation";

type LocalProjectControlCapability =
  | "connectCandidate"
  | "connectDeclaredPath"
  | "discoverProjects"
  | "moveConnection"
  | "removeConnection"
  | "removeMissingConnections"
  | "setDefaultConnection";

type LocalProjectControlTarget = {
  deviceId: string;
  runtimeLane: "canary" | "dev-local" | "prod";
};

type ResolveCurrentLocalProjectControlTarget = (input: {
  capability: LocalProjectControlCapability;
  env: CoreBindings;
  userId: string;
}) => Promise<LocalProjectControlTarget>;

export type LocalProjectControlRpcDependencies = {
  resolveCurrentTarget: ResolveCurrentLocalProjectControlTarget;
};

export function createLocalProjectControlRpc(
  dependencies: LocalProjectControlRpcDependencies
) {
  return {
    async connectCandidate(
      env: CoreBindings,
      input: LocalProjectControlConnectCandidateRpcInput
    ): Promise<LocalProjectControlConnectOutcome> {
      const parsed =
        localProjectControlConnectCandidateRpcInputSchema.safeParse(input);
      if (!parsed.success) {
        throwInvalidPayload(parsed.error.message);
      }
      const { context, ...request } = parsed.data;
      const prepared = await prepareRequest({
        context,
        env,
        expectedOrganizationId: request.expectedOrganizationId,
      });
      const project = requireActiveProject(
        prepared.projects,
        request.projectId
      );
      const target = await dependencies.resolveCurrentTarget({
        capability: request.moveConfirmationToken
          ? "moveConnection"
          : "connectCandidate",
        env,
        userId: prepared.userId,
      });
      return requireConnectOutcome(
        await connectRuntimeTransportProjectCandidate({
          deviceId: target.deviceId,
          env,
          ownerUserId: prepared.userId,
          request: buildCanonicalLocalProjectConnectRequest({
            project,
            request,
          }),
          runtimeLane: target.runtimeLane,
        })
      );
    },

    async connectDeclaredPath(
      env: CoreBindings,
      input: LocalProjectControlConnectDeclaredPathRpcInput
    ): Promise<LocalProjectControlConnectOutcome> {
      const parsed =
        localProjectControlConnectDeclaredPathRpcInputSchema.safeParse(input);
      if (!parsed.success) {
        throwInvalidPayload(parsed.error.message);
      }
      const { context, ...request } = parsed.data;
      const prepared = await prepareRequest({
        context,
        env,
        expectedOrganizationId: request.expectedOrganizationId,
      });
      const project = requireActiveProject(
        prepared.projects,
        request.projectId
      );
      const target = await dependencies.resolveCurrentTarget({
        capability: request.moveConfirmationToken
          ? "moveConnection"
          : "connectDeclaredPath",
        env,
        userId: prepared.userId,
      });
      return requireConnectOutcome(
        await connectRuntimeTransportProjectDeclaredPath({
          deviceId: target.deviceId,
          env,
          ownerUserId: prepared.userId,
          request: buildCanonicalLocalProjectConnectRequest({
            project,
            request,
          }),
          runtimeLane: target.runtimeLane,
        })
      );
    },

    async discoverProjects(
      env: CoreBindings,
      input: LocalProjectControlDiscoverProjectsRpcInput
    ): Promise<LocalProjectControlDiscoverProjectsResponse> {
      const parsed =
        localProjectControlDiscoverProjectsRpcInputSchema.safeParse(input);
      if (!parsed.success) {
        throwInvalidPayload(parsed.error.message);
      }
      const request = parsed.data;
      const prepared = await prepareRequest({
        context: request.context,
        env,
        expectedOrganizationId: request.expectedOrganizationId,
      });
      const selectedIds = request.projectIds
        ? new Set(request.projectIds)
        : null;
      const projects = prepared.projects.filter(
        (project) => selectedIds?.has(project.id) ?? true
      );
      const target = await dependencies.resolveCurrentTarget({
        capability: "discoverProjects",
        env,
        userId: prepared.userId,
      });
      return requireSuccess(
        await discoverRuntimeTransportProjects({
          deviceId: target.deviceId,
          env,
          ownerUserId: prepared.userId,
          request: buildCanonicalLocalProjectDiscoveryRequest({
            projects,
            request,
          }),
          runtimeLane: target.runtimeLane,
        })
      );
    },

    async removeConnection(
      env: CoreBindings,
      input: LocalProjectControlRemoveConnectionRpcInput
    ): Promise<LocalProjectControlRemoveConnectionResponse> {
      const parsed =
        localProjectControlRemoveConnectionRpcInputSchema.safeParse(input);
      if (!parsed.success) {
        throwInvalidPayload(parsed.error.message);
      }
      const { context, ...request } = parsed.data;
      const prepared = await prepareRequest({
        context,
        env,
        expectedOrganizationId: request.expectedOrganizationId,
      });
      requireActiveProject(prepared.projects, request.projectId);
      const target = await dependencies.resolveCurrentTarget({
        capability: "removeConnection",
        env,
        userId: prepared.userId,
      });
      return requireSuccess(
        await removeRuntimeTransportProjectConnection({
          deviceId: target.deviceId,
          env,
          ownerUserId: prepared.userId,
          request,
          runtimeLane: target.runtimeLane,
        })
      );
    },

    async removeMissingConnections(
      env: CoreBindings,
      input: LocalProjectControlRemoveMissingConnectionsRpcInput
    ): Promise<LocalProjectControlRemoveMissingConnectionsResponse> {
      const parsed =
        localProjectControlRemoveMissingConnectionsRpcInputSchema.safeParse(
          input
        );
      if (!parsed.success) {
        throwInvalidPayload(parsed.error.message);
      }
      const { context, ...request } = parsed.data;
      const prepared = await prepareRequest({
        context,
        env,
        expectedOrganizationId: request.expectedOrganizationId,
      });
      requireActiveProject(prepared.projects, request.projectId);
      const target = await dependencies.resolveCurrentTarget({
        capability: "removeMissingConnections",
        env,
        userId: prepared.userId,
      });
      return requireSuccess(
        await removeRuntimeTransportMissingProjectConnections({
          deviceId: target.deviceId,
          env,
          ownerUserId: prepared.userId,
          request,
          runtimeLane: target.runtimeLane,
        })
      );
    },

    async setDefaultConnection(
      env: CoreBindings,
      input: LocalProjectControlSetDefaultConnectionRpcInput
    ): Promise<LocalProjectControlSetDefaultConnectionResponse> {
      const parsed =
        localProjectControlSetDefaultConnectionRpcInputSchema.safeParse(input);
      if (!parsed.success) {
        throwInvalidPayload(parsed.error.message);
      }
      const { context, ...request } = parsed.data;
      const prepared = await prepareRequest({
        context,
        env,
        expectedOrganizationId: request.expectedOrganizationId,
      });
      requireActiveProject(prepared.projects, request.projectId);
      const target = await dependencies.resolveCurrentTarget({
        capability: "setDefaultConnection",
        env,
        userId: prepared.userId,
      });
      return requireSuccess(
        await setRuntimeTransportDefaultProjectConnection({
          deviceId: target.deviceId,
          env,
          ownerUserId: prepared.userId,
          request,
          runtimeLane: target.runtimeLane,
        })
      );
    },
  };
}

export function buildCanonicalLocalProjectDiscoveryRequest(input: {
  projects: readonly Project[];
  request: Pick<
    LocalProjectControlDiscoverProjectsRpcInput,
    "clientGeneration" | "expectedOrganizationId"
  >;
}) {
  return {
    clientGeneration: input.request.clientGeneration,
    expectedOrganizationId: input.request.expectedOrganizationId,
    projects: input.projects.map((project) => ({
      projectId: project.id,
      repositoryFingerprint: project.repositoryFingerprint,
    })),
  };
}

export function buildCanonicalLocalProjectConnectRequest<
  TRequest extends
    | Omit<LocalProjectControlConnectCandidateRpcInput, "context">
    | Omit<LocalProjectControlConnectDeclaredPathRpcInput, "context">,
>(input: { project: Project; request: TRequest }) {
  return {
    ...input.request,
    projectSlug: input.project.slug,
    repositoryFingerprint: input.project.repositoryFingerprint,
  };
}

async function prepareRequest(input: {
  context: LocalProjectControlDiscoverProjectsRpcInput["context"];
  env: CoreBindings;
  expectedOrganizationId: string;
}): Promise<{ projects: Project[]; userId: string }> {
  const { authority, service } = await prepareExpectedHumanProjectRequest(
    input.env,
    {
      context: input.context,
      expectedOrganizationId: input.expectedOrganizationId,
    }
  );
  const response = await service.list(authority);
  return { projects: response.projects, userId: authority.userId };
}

function requireActiveProject(
  projects: readonly Project[],
  projectId: string
): Project {
  const project = projects.find(
    (candidate) => candidate.id === projectId && candidate.archivedAtMs === null
  );
  if (!project) {
    throw createCoreRpcHttpError({
      code: "project.not_found",
      reason: "The active Project was not found.",
      status: 404,
    });
  }
  return project;
}

function throwInvalidPayload(message: string): never {
  throw createCoreRpcHttpError({
    code: "invalid_payload",
    reason: message,
    status: 400,
  });
}

function requireSuccess<T>(result: LocalProjectControlErrorResponse | T): T {
  if (!isLocalProjectControlErrorResponse(result)) {
    return result;
  }
  let status = 409;
  if (result.code === "timeout") {
    status = 504;
  } else if (result.code === "service_offline") {
    status = 503;
  } else if (result.code === "invalid_request") {
    status = 400;
  } else if (
    result.code === "internal_error" ||
    result.code === "invalid_response"
  ) {
    status = 502;
  }
  throw createCoreRpcHttpError({
    code: result.code,
    reason: result.message,
    status,
  });
}

function requireConnectOutcome(
  result: LocalProjectControlConnectResponse | LocalProjectControlErrorResponse
): LocalProjectControlConnectOutcome {
  if (isDetailedLocalProjectControlPathConflictResponse(result)) {
    return result;
  }
  if (result.status === "rejected" && result.code === "path_conflict") {
    throw createCoreRpcHttpError({
      code: result.code,
      reason: `This folder is already connected to the “${result.conflictingProjectSlug}” Project. Update OpenMeld Service to move it here.`,
      status: 409,
    });
  }
  if (isLocalProjectControlErrorResponse(result)) {
    return requireSuccess<LocalProjectControlConnectResponse>(result);
  }
  return result;
}

function isDetailedLocalProjectControlPathConflictResponse(
  result: LocalProjectControlConnectResponse | LocalProjectControlErrorResponse
): result is LocalProjectControlPathConflictResponse {
  return (
    result.status === "rejected" &&
    result.code === "path_conflict" &&
    "moveConfirmationToken" in result
  );
}

function isLocalProjectControlErrorResponse(
  value: unknown
): value is LocalProjectControlErrorResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "status" in value &&
      value.status === "rejected" &&
      "code" in value &&
      typeof value.code === "string" &&
      "message" in value &&
      typeof value.message === "string"
  );
}
