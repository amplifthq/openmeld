import {
  type LocalProjectControlConnection,
  type LocalProjectControlDaemonFrame,
  type LocalProjectControlErrorResponse,
  localProjectControlDaemonFrameSchema,
} from "@openmeld/schemas";
import { isProjectConnectionUsableByOwner } from "../../agent-activity/project-binding-resolution";
import {
  bindProject,
  listProjectConnectionsWithStatus,
  ProjectBindingOperationError,
  ProjectBindingStoreUpdateRequiredError,
  removeMissingProjectConnections,
  removeProjectConnection,
  setDefaultProjectConnection,
} from "../../agent-activity/project-bindings";
import {
  LocalProjectConnectionError,
  validateLocalProjectConnectionPath,
} from "./local-project-connection";
import { LocalProjectControlIdempotencyCache } from "./local-project-control-idempotency";
import {
  buildLocalProjectCandidateId,
  discoverLocalProjects,
} from "./local-project-discovery";
import { LocalProjectDiscoveryEpochs } from "./local-project-discovery-epoch";

type HandlerDependencies = {
  bind?: typeof bindProject;
  discoveryEpochs?: LocalProjectDiscoveryEpochs;
  discover?: typeof discoverLocalProjects;
  idempotencyCache?: LocalProjectControlIdempotencyCache<LocalProjectControlDaemonFrame>;
  listConnections?: typeof listProjectConnectionsWithStatus;
  remove?: typeof removeProjectConnection;
  removeMissing?: typeof removeMissingProjectConnections;
  setDefault?: typeof setDefaultProjectConnection;
  validate?: typeof validateLocalProjectConnectionPath;
};

const defaultDiscoveryEpochs = new LocalProjectDiscoveryEpochs();
const defaultIdempotencyCache =
  new LocalProjectControlIdempotencyCache<LocalProjectControlDaemonFrame>();

type RequestFrame = Extract<
  LocalProjectControlDaemonFrame,
  {
    code:
      | "daemon.local_project_control.connect_candidate"
      | "daemon.local_project_control.connect_declared_path"
      | "daemon.local_project_control.discover_projects"
      | "daemon.local_project_control.remove_connection"
      | "daemon.local_project_control.remove_missing_connections"
      | "daemon.local_project_control.set_default_connection";
  }
>;

export async function handleLocalProjectControlFrame(
  input: {
    deviceId: string;
    frame: unknown;
    ownerUserId?: string;
    rootDir?: string;
  },
  dependencies: HandlerDependencies = {}
): Promise<LocalProjectControlDaemonFrame> {
  const parsed = localProjectControlDaemonFrameSchema.safeParse(input.frame);
  if (!(parsed.success && isRequestFrame(parsed.data))) {
    throw new Error("The local Project control request frame is invalid.", {
      cause: parsed.success ? undefined : parsed.error,
    });
  }
  const frame = parsed.data;
  if (isIdempotentRequestFrame(frame)) {
    return await executeIdempotentRequestFrame(frame, input, dependencies);
  }
  try {
    return await executeRequestFrame(frame, input, dependencies);
  } catch (error) {
    return buildErrorResultFrame(frame, toControlError(error));
  }
}

async function executeIdempotentRequestFrame(
  frame: Exclude<
    RequestFrame,
    { code: "daemon.local_project_control.discover_projects" }
  >,
  input: { deviceId: string; ownerUserId?: string; rootDir?: string },
  dependencies: HandlerDependencies
): Promise<LocalProjectControlDaemonFrame> {
  const request = frame.payload.request;
  const resolution = await (
    dependencies.idempotencyCache ?? defaultIdempotencyCache
  ).resolve({
    execute: () =>
      executeRequestFrame(frame, input, dependencies).catch((error: unknown) =>
        buildErrorResultFrame(frame, toControlError(error))
      ),
    idempotencyKey: request.idempotencyKey,
    operationCode: frame.code,
    organizationId: request.expectedOrganizationId,
    projectId: request.projectId,
    request,
  });
  if (resolution.status === "conflict") {
    return buildErrorResultFrame(
      frame,
      rejection(
        "invalid_request",
        "This idempotency key was already used for a different Project connection request."
      )
    );
  }
  return resolution.status === "replayed"
    ? rebuildResultFrame(frame, resolution.value)
    : resolution.value;
}

async function executeRequestFrame(
  frame: RequestFrame,
  input: { deviceId: string; ownerUserId?: string; rootDir?: string },
  dependencies: HandlerDependencies
): Promise<LocalProjectControlDaemonFrame> {
  switch (frame.code) {
    case "daemon.local_project_control.discover_projects":
      return await handleDiscoverFrame(frame, input, dependencies);
    case "daemon.local_project_control.connect_candidate":
      return await handleConnectCandidateFrame(frame, input, dependencies);
    case "daemon.local_project_control.connect_declared_path":
      return await handleConnectDeclaredPathFrame(frame, input, dependencies);
    case "daemon.local_project_control.set_default_connection":
      return await handleSetDefaultFrame(frame, input, dependencies);
    case "daemon.local_project_control.remove_connection":
      return await handleRemoveFrame(frame, input, dependencies);
    case "daemon.local_project_control.remove_missing_connections":
      return await handleRemoveMissingFrame(frame, input, dependencies);
    default:
      throw new Error("Unsupported local Project control operation.");
  }
}

async function handleDiscoverFrame(
  frame: Extract<
    RequestFrame,
    { code: "daemon.local_project_control.discover_projects" }
  >,
  input: { deviceId: string; ownerUserId?: string; rootDir?: string },
  dependencies: HandlerDependencies
): Promise<LocalProjectControlDaemonFrame> {
  const epoch =
    frame.payload.request.includeCandidates === false
      ? null
      : (dependencies.discoveryEpochs ?? defaultDiscoveryEpochs).begin({
          organizationId: frame.payload.request.expectedOrganizationId,
        });
  const response = await (dependencies.discover ?? discoverLocalProjects)({
    ...frame.payload.request,
    deviceId: input.deviceId,
    ownerUserId: input.ownerUserId,
    requestId: frame.payload.requestId,
    rootDir: input.rootDir,
  });
  const projects = epoch
    ? (dependencies.discoveryEpochs ?? defaultDiscoveryEpochs).complete(
        epoch,
        response.projects
      )
    : response.projects;
  return buildResultFrame(
    "daemon.local_project_control.discover_projects_result",
    frame.payload.requestId,
    { ...response, projects }
  );
}

async function handleConnectCandidateFrame(
  frame: Extract<
    RequestFrame,
    { code: "daemon.local_project_control.connect_candidate" }
  >,
  input: { ownerUserId?: string; rootDir?: string },
  dependencies: HandlerDependencies
): Promise<LocalProjectControlDaemonFrame> {
  const request = frame.payload.request;
  const discoveryCandidateId = (
    dependencies.discoveryEpochs ?? defaultDiscoveryEpochs
  ).resolveDiscoveryCandidateId({
    candidateId: request.candidateId,
    candidatePath: request.candidatePath,
    organizationId: request.expectedOrganizationId,
    projectId: request.projectId,
  });
  if (!discoveryCandidateId) {
    return buildResultFrame(
      "daemon.local_project_control.connect_candidate_result",
      frame.payload.requestId,
      rejection(
        "candidate_unavailable",
        "This discovered folder is no longer available. Discover Projects again and choose a current result."
      )
    );
  }
  const connection = await (
    dependencies.validate ?? validateLocalProjectConnectionPath
  )({
    allowUnverifiedNonGit: false,
    declaredPath: request.candidatePath,
    projectRepositoryFingerprint: request.repositoryFingerprint,
  });
  if (
    connection.repositoryFingerprint === null ||
    buildLocalProjectCandidateId(
      connection.canonicalPath,
      connection.repositoryFingerprint
    ) !== discoveryCandidateId
  ) {
    return buildResultFrame(
      "daemon.local_project_control.connect_candidate_result",
      frame.payload.requestId,
      rejection(
        "candidate_unavailable",
        "This discovered folder is no longer available. Discover Projects again and choose a current result."
      )
    );
  }
  const result = await connectValidatedPath({
    bind: dependencies.bind,
    connection,
    ownerUserId: input.ownerUserId,
    request,
    rootDir: input.rootDir,
  });
  return buildResultFrame(
    "daemon.local_project_control.connect_candidate_result",
    frame.payload.requestId,
    result
  );
}

async function handleConnectDeclaredPathFrame(
  frame: Extract<
    RequestFrame,
    { code: "daemon.local_project_control.connect_declared_path" }
  >,
  input: { ownerUserId?: string; rootDir?: string },
  dependencies: HandlerDependencies
): Promise<LocalProjectControlDaemonFrame> {
  const request = frame.payload.request;
  const connection = await (
    dependencies.validate ?? validateLocalProjectConnectionPath
  )({
    allowUnverifiedNonGit: request.confirmNonGit === true,
    declaredPath: request.declaredPath,
    projectRepositoryFingerprint: request.repositoryFingerprint,
  });
  const result = await connectValidatedPath({
    bind: dependencies.bind,
    connection,
    ownerUserId: input.ownerUserId,
    request,
    rootDir: input.rootDir,
  });
  return buildResultFrame(
    "daemon.local_project_control.connect_declared_path_result",
    frame.payload.requestId,
    result
  );
}

async function handleSetDefaultFrame(
  frame: Extract<
    RequestFrame,
    { code: "daemon.local_project_control.set_default_connection" }
  >,
  input: { rootDir?: string },
  dependencies: HandlerDependencies
): Promise<LocalProjectControlDaemonFrame> {
  const request = frame.payload.request;
  const before = await projectConnections(request, input, dependencies);
  const target = before.find(
    (connection) =>
      connection.bindingGeneration === request.targetBindingGeneration
  );
  if (!target) {
    throw new ProjectBindingOperationError(
      "binding_generation_stale",
      "The Project connection is missing or stale."
    );
  }
  await (dependencies.setDefault ?? setDefaultProjectConnection)({
    expectedBindingGeneration: request.targetBindingGeneration,
    organizationId: request.expectedOrganizationId,
    projectId: request.projectId,
    rootDir: input.rootDir,
  });
  return buildResultFrame(
    "daemon.local_project_control.set_default_connection_result",
    frame.payload.requestId,
    {
      connections: await projectConnections(request, input, dependencies),
      status: target.isDefault ? "unchanged" : "updated",
    }
  );
}

async function handleRemoveFrame(
  frame: Extract<
    RequestFrame,
    { code: "daemon.local_project_control.remove_connection" }
  >,
  input: { rootDir?: string },
  dependencies: HandlerDependencies
): Promise<LocalProjectControlDaemonFrame> {
  const request = frame.payload.request;
  const before = await projectConnections(request, input, dependencies);
  if (
    !before.some(
      (connection) => connection.bindingGeneration === request.bindingGeneration
    )
  ) {
    return buildResultFrame(
      "daemon.local_project_control.remove_connection_result",
      frame.payload.requestId,
      { connections: before, status: "unchanged" }
    );
  }
  await (dependencies.remove ?? removeProjectConnection)({
    expectedBindingGeneration: request.bindingGeneration,
    organizationId: request.expectedOrganizationId,
    projectId: request.projectId,
    replacementBindingGeneration: request.replacementBindingGeneration,
    rootDir: input.rootDir,
  });
  return buildResultFrame(
    "daemon.local_project_control.remove_connection_result",
    frame.payload.requestId,
    {
      connections: await projectConnections(request, input, dependencies),
      status: "removed",
    }
  );
}

async function handleRemoveMissingFrame(
  frame: Extract<
    RequestFrame,
    { code: "daemon.local_project_control.remove_missing_connections" }
  >,
  input: { rootDir?: string },
  dependencies: HandlerDependencies
): Promise<LocalProjectControlDaemonFrame> {
  const request = frame.payload.request;
  const result = await (
    dependencies.removeMissing ?? removeMissingProjectConnections
  )({
    organizationId: request.expectedOrganizationId,
    projectId: request.projectId,
    rootDir: input.rootDir,
  });
  return buildResultFrame(
    "daemon.local_project_control.remove_missing_connections_result",
    frame.payload.requestId,
    {
      connections: await projectConnections(request, input, dependencies),
      removedCount: result.removed.length,
    }
  );
}

function isRequestFrame(
  frame: LocalProjectControlDaemonFrame
): frame is RequestFrame {
  return !frame.code.endsWith("_result");
}

function isIdempotentRequestFrame(
  frame: RequestFrame
): frame is Exclude<
  RequestFrame,
  { code: "daemon.local_project_control.discover_projects" }
> {
  return frame.code !== "daemon.local_project_control.discover_projects";
}

function rebuildResultFrame(
  requestFrame: Exclude<
    RequestFrame,
    { code: "daemon.local_project_control.discover_projects" }
  >,
  cachedFrame: LocalProjectControlDaemonFrame
): LocalProjectControlDaemonFrame {
  if (
    !(cachedFrame.code.endsWith("_result") && "result" in cachedFrame.payload)
  ) {
    return buildErrorResultFrame(
      requestFrame,
      rejection(
        "internal_error",
        "The cached Project control result is invalid."
      )
    );
  }
  return buildResultFrame(
    `${requestFrame.code}_result` as Parameters<typeof buildResultFrame>[0],
    requestFrame.payload.requestId,
    cachedFrame.payload.result
  );
}

async function connectValidatedPath(input: {
  bind?: typeof bindProject;
  connection: Awaited<ReturnType<typeof validateLocalProjectConnectionPath>>;
  ownerUserId?: string;
  request: {
    expectedOrganizationId: string;
    moveConfirmationToken?: string;
    shareConfirmationToken?: string;
    projectId: string;
    projectSlug: string;
  };
  rootDir?: string;
}) {
  const before = await listProjectConnectionsWithStatus({
    organizationId: input.request.expectedOrganizationId,
    rootDir: input.rootDir,
  });
  const existing = before.find(
    (binding) =>
      binding.projectId === input.request.projectId &&
      binding.repositoryPath === input.connection.canonicalPath
  );
  const binding = await (input.bind ?? bindProject)({
    moveConfirmationToken: input.request.moveConfirmationToken,
    shareConfirmationToken: input.request.shareConfirmationToken,
    organizationId: input.request.expectedOrganizationId,
    ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
    projectId: input.request.projectId,
    projectSlug: input.request.projectSlug,
    repositoryFingerprint: input.connection.repositoryFingerprint,
    repositoryPath: input.connection.canonicalPath,
    rootDir: input.rootDir,
  });
  return {
    bindingGeneration: binding.bindingGeneration,
    canonicalPath: binding.repositoryPath,
    isDefault: binding.isDefault,
    status:
      existing?.bindingGeneration === binding.bindingGeneration
        ? ("unchanged" as const)
        : ("connected" as const),
  };
}

async function projectConnections(
  request: { expectedOrganizationId: string; projectId: string },
  input: { ownerUserId?: string; rootDir?: string },
  dependencies: HandlerDependencies
): Promise<LocalProjectControlConnection[]> {
  return (
    await (dependencies.listConnections ?? listProjectConnectionsWithStatus)({
      organizationId: request.expectedOrganizationId,
      rootDir: input.rootDir,
    })
  )
    .filter(
      (connection) =>
        connection.projectId === request.projectId &&
        isProjectConnectionUsableByOwner(connection, input.ownerUserId)
    )
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

function rejection(
  code: Exclude<LocalProjectControlErrorResponse["code"], "path_conflict">,
  message: string
): LocalProjectControlErrorResponse {
  return { code, message, status: "rejected" };
}

function toControlError(error: unknown): LocalProjectControlErrorResponse {
  if (error instanceof ProjectBindingOperationError) {
    if (error.code === "path_conflict") {
      if (!error.pathConflict) {
        return rejection("internal_error", error.message);
      }
      return {
        code: error.code,
        ...error.pathConflict,
        message: error.message,
        status: "rejected",
      };
    }
    return rejection(error.code, error.message);
  }
  if (error instanceof ProjectBindingStoreUpdateRequiredError) {
    return rejection("service_update_required", error.message);
  }
  if (error instanceof LocalProjectConnectionError) {
    if (error.code === "git_verification_unavailable") {
      let code: "command_line_tools_missing" | "git_unavailable" | "timeout" =
        "git_unavailable";
      if (error.gitStatus === "command_line_tools_missing") {
        code = "command_line_tools_missing";
      } else if (error.gitStatus === "timed_out") {
        code = "timeout";
      }
      return rejection(code, error.message);
    }
    const code = {
      confirmation_required: "needs_confirmation",
      git_repository_required: "git_repository_required",
      path_not_directory: "path_not_directory",
      path_not_found: "path_not_found",
      path_unreadable: "path_unreadable",
      repository_fingerprint_mismatch: "fingerprint_mismatch",
    }[error.code] as Exclude<
      LocalProjectControlErrorResponse["code"],
      "path_conflict"
    >;
    return rejection(code, error.message);
  }
  return rejection(
    "internal_error",
    error instanceof Error
      ? error.message
      : "Local Project control failed unexpectedly."
  );
}

function buildResultFrame(
  code:
    | "daemon.local_project_control.connect_candidate_result"
    | "daemon.local_project_control.connect_declared_path_result"
    | "daemon.local_project_control.discover_projects_result"
    | "daemon.local_project_control.remove_connection_result"
    | "daemon.local_project_control.remove_missing_connections_result"
    | "daemon.local_project_control.set_default_connection_result",
  requestId: string,
  result: unknown
): LocalProjectControlDaemonFrame {
  return localProjectControlDaemonFrameSchema.parse({
    code,
    payload: { requestId, result },
    v: 1,
  });
}

function buildErrorResultFrame(
  frame: RequestFrame,
  error: LocalProjectControlErrorResponse
): LocalProjectControlDaemonFrame {
  const code = `${frame.code}_result` as Parameters<typeof buildResultFrame>[0];
  return buildResultFrame(code, frame.payload.requestId, error);
}
