import * as z from "zod/v4";
import {
  localExecutionInputRequestSchema as executionInputRequest,
  localExecutionInputResponseSchema as executionInputResponse,
} from "./local-execution-input";
import {
  openMeldDaemonCancelPayloadSchema,
  openMeldDaemonCancelRequestPayloadSchema,
  openMeldDaemonConversationExecutionStatusPayloadSchema,
  openMeldDaemonConversationExecutionStatusRequestPayloadSchema,
  openMeldDaemonInterruptPayloadSchema,
  openMeldDaemonInterruptRequestPayloadSchema,
  openMeldDaemonSetLocalAgentEnabledPayloadSchema,
  openMeldDaemonSetLocalAgentEnabledRequestPayloadSchema,
  skippedDaemonProfileSchema,
} from "./schemas/daemon/control-plane";
import { providerDispatchRuntimeContextSchema } from "./schemas/daemon/provider-runtime-context";
import { cachedDaemonRouteConfigSchema } from "./schemas/daemon/route-catalog-cache";
import {
  daemonStreamFrameSchema,
  localWakeRouteWorkingFolderObservationSchema,
  runtimeTransportLeaseSchema,
} from "./schemas/daemon/runtime-transport";
import { daemonServiceLaneSchema } from "./schemas/daemon/service-contract";

export const SERVICE_EXECUTION_HOST_PROTOCOL = "service-execution-host-v1";
export const SERVICE_EXECUTION_HOST_MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const SERVICE_EXECUTION_HOST_MAX_PENDING_REQUESTS = 64;

const identityString = z.string().min(1).max(1024);
const count = z.number().int().nonnegative();
const empty = z.strictObject({});

// Private inherited IPC only. These observations are not cloud grants, public
// status, or permission to select another account or installation.
export const serviceExecutionHostIdentitySchema = z.strictObject({
  ownerUserId: identityString,
  deviceId: identityString,
  lane: daemonServiceLaneSchema,
  daemonSessionId: identityString,
  serviceContractGeneration: count,
  sessionIdentity: identityString,
  stateRoot: z.string().min(1).max(4096),
  authBaseUrl: z.url(),
  gatewayBaseUrl: z.url(),
  parentPid: z.number().int().positive(),
  parentProcessStartedAt: identityString,
});

export const serviceExecutionHostSnapshotSchema = z.strictObject({
  pid: z.number().int().positive(),
  admission: z.enum(["open", "draining"]),
  activeCount: count,
  pendingCount: count,
  localQuiescent: z.boolean(),
  unacknowledgedResultCount: count,
  startupReplayPending: z.boolean(),
  adapterIds: z.array(identityString).max(256),
});

const serviceExecutionHostOwnerV1Schema = z.strictObject({
  schema: z.literal("service-execution-host-owner-v1"),
  hostInstanceId: z.uuid(),
  ownerUserId: identityString,
  deviceId: identityString,
  lane: daemonServiceLaneSchema,
  pid: z.number().int().positive(),
  bootIdentity: identityString.nullable(),
  localQuiescent: z.boolean(),
});

const serviceExecutionHostOwnedProcessTreeSchema = z.strictObject({
  pid: z.number().int().positive(),
  processStartedAt: identityString,
  signalTarget: z.enum(["process", "process_group"]),
});

// A process-incarnation recovery fence, not a task ledger. V2 records the
// exact Host and provider process trees needed to prove a same-boot takeover
// safe. V1 remains readable but cannot authorize that recovery.
const serviceExecutionHostOwnerV2Schema = z.strictObject({
  schema: z.literal("service-execution-host-owner-v2"),
  hostInstanceId: z.uuid(),
  ownerUserId: identityString,
  deviceId: identityString,
  lane: daemonServiceLaneSchema,
  pid: z.number().int().positive(),
  processStartedAt: identityString,
  bootIdentity: identityString.nullable(),
  localQuiescent: z.boolean(),
  processEvidenceComplete: z.boolean(),
  ownedProcessTrees: z
    .array(serviceExecutionHostOwnedProcessTreeSchema)
    .max(64),
});

export const serviceExecutionHostOwnerSchema = z.discriminatedUnion("schema", [
  serviceExecutionHostOwnerV1Schema,
  serviceExecutionHostOwnerV2Schema,
]);

export const profileWorkingFolderFactSchema = z.strictObject({
  defaultProjectId: identityString.nullable(),
  localProjectBindingGeneration: identityString.nullable(),
  observedAtMs: count,
  reasonCode: z
    .enum([
      "profile.workspace.invalid",
      "profile.workspace.missing",
      "project.local_connection.folder_missing",
      "project.local_connection.invalid",
      "project.local_connection.missing",
    ])
    .nullable(),
  source: z.enum(["default_project", "profile_workspace"]),
  status: z.enum(["invalid", "missing", "ready"]),
});

const readyWorkingFolder = {
  configuredWorkspacePath: z.string().min(1),
  effectiveRuntimeWorkingDirectory: z.string().min(1),
  runtimeContext: providerDispatchRuntimeContextSchema,
  status: z.literal("ready"),
  workingFolderFact: profileWorkingFolderFactSchema,
};

const workingFolderRuntimeSchema = z.union([
  z.strictObject({
    ...readyWorkingFolder,
    configPath: z.string().min(1),
    workspaceMode: z.enum(["openmeld_managed", "custom"]),
    workingFolderSource: z.literal("profile_workspace"),
  }),
  z.strictObject({
    configPath: z.string().min(1),
    configuredWorkspacePath: z.null().optional(),
    reasonCode: z.literal("workspace.missing"),
    reasonText: z.string().min(1),
    status: z.literal("missing"),
    workingFolderFact: profileWorkingFolderFactSchema,
    workingFolderSource: z.literal("profile_workspace"),
    workspaceMode: z.null().optional(),
  }),
  z.strictObject({
    configPath: z.string().min(1),
    configuredWorkspacePath: z.string().min(1).nullable().optional(),
    reasonCode: z.literal("workspace.invalid"),
    reasonText: z.string().min(1),
    status: z.literal("invalid"),
    workingFolderFact: profileWorkingFolderFactSchema,
    workingFolderSource: z.literal("profile_workspace"),
    workspaceMode: z.enum(["openmeld_managed", "custom"]).nullable().optional(),
  }),
  z.strictObject({
    ...readyWorkingFolder,
    configPath: z.null(),
    workspaceMode: z.null(),
    defaultProjectId: identityString,
    defaultProjectBindingGeneration: identityString,
    workingFolderSource: z.literal("default_project"),
  }),
  z.strictObject({
    configPath: z.null(),
    configuredWorkspacePath: z.string().min(1).nullable(),
    defaultProjectBindingGeneration: identityString.optional(),
    defaultProjectFailureReason: z.enum([
      "folder_missing",
      "missing_connection",
    ]),
    defaultProjectId: identityString,
    reasonCode: z.literal("workspace.missing"),
    reasonText: z.string().min(1),
    status: z.literal("missing"),
    workingFolderFact: profileWorkingFolderFactSchema,
    workingFolderSource: z.literal("default_project"),
    workspaceMode: z.null(),
  }),
  z.strictObject({
    configPath: z.null(),
    configuredWorkspacePath: z.string().min(1),
    defaultProjectBindingGeneration: identityString,
    defaultProjectId: identityString,
    reasonCode: z.literal("workspace.invalid"),
    reasonText: z.string().min(1),
    status: z.literal("invalid"),
    workingFolderFact: profileWorkingFolderFactSchema,
    workingFolderSource: z.literal("default_project"),
    workspaceMode: z.null(),
  }),
]);

export const serviceExecutionHostRouteSchema =
  cachedDaemonRouteConfigSchema.extend({
    agentControllerConversationId: identityString.nullable().optional(),
    workingFolderRuntime: workingFolderRuntimeSchema.optional(),
  });

export const serviceExecutionHostCatalogSchema = z
  .strictObject({
    revision: z.number().int().positive(),
    expectedRoutesContractVersion: z.literal("v4").optional(),
    profileIds: z.array(identityString).max(10_000),
    routes: z.array(serviceExecutionHostRouteSchema).max(10_000),
    skippedProfiles: z.array(skippedDaemonProfileSchema).max(10_000),
    workingFolderExpectedProfileIds: z
      .array(identityString)
      .max(10_000)
      .optional(),
    workingFolderObservations: z
      .array(localWakeRouteWorkingFolderObservationSchema)
      .max(10_000)
      .optional(),
  })
  .superRefine((catalog, context) => {
    const ids = new Set(catalog.profileIds);
    const routes = new Set(catalog.routes.map((route) => route.profileId));
    if (
      ids.size !== catalog.profileIds.length ||
      routes.size !== catalog.routes.length ||
      ids.size !== routes.size ||
      catalog.profileIds.some((id) => !routes.has(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "Host catalog must contain exactly one route per profile.",
      });
    }
  });

const reportResult = z.strictObject({
  status: z.enum(["skipped", "submitted"]),
  reasonCodes: z.array(z.string().max(256)).max(1024),
  submittedCount: count,
  failedCount: count,
});

const executionFrameCodes = new Set([
  "daemon.computer_power.request",
  "daemon.dispatch.deliver",
  "daemon.dispatch.lifecycle_acknowledged",
  "daemon.dispatch.accepted",
  "daemon.dispatch.interaction_response",
  "daemon.reasoning.preferences",
  "daemon.local_agent_control.cancel",
  "daemon.local_agent_control.interrupt",
  "daemon.local_agent_control.fork_session",
  "daemon.local_agent_control.manage_installation",
  "daemon.local_agent_control.set_enabled",
  "daemon.execution_recovery.resume_controller_conversation",
]);

const executionOutputFrameCodes = new Set([
  "daemon.computer_power.request_result",
  "daemon.dispatch.result",
  "daemon.dispatch.lifecycle",
  "daemon.dispatch.runtime_evidence",
  "daemon.dispatch.reasoning",
  "daemon.dispatch.progress",
  "daemon.dispatch.reply",
  "daemon.dispatch.tool_activity",
  "daemon.dispatch.interaction_request",
  "daemon.dispatch.interaction_delivered",
  "daemon.dispatch.preview",
  "daemon.dispatch.preview_end",
  "daemon.local_agent_control.result",
  "daemon.execution_recovery.resume_controller_conversation_result",
]);

// One fixed method table validates both ends. The envelope is decoded first;
// payloads are never dispatched or returned without the selected method schema.
export const serviceExecutionHostMethods = {
  initialize: {
    input: serviceExecutionHostIdentitySchema,
    output: serviceExecutionHostSnapshotSchema,
  },
  health: { input: empty, output: serviceExecutionHostSnapshotSchema },
  loadCatalog: {
    input: z.strictObject({ initial: z.boolean() }),
    output: serviceExecutionHostCatalogSchema,
  },
  configureConnection: {
    input: z.strictObject({
      executionAdmissionConfirmation: z.boolean().optional(),
      connectionGeneration: z.number().int().positive(),
      catalogRevision: count,
      leases: z.array(runtimeTransportLeaseSchema).max(10_000),
    }),
    output: serviceExecutionHostSnapshotSchema,
  },
  detachConnection: {
    input: z.strictObject({
      connectionGeneration: z.number().int().positive(),
    }),
    output: serviceExecutionHostSnapshotSchema,
  },
  heartbeat: {
    input: z.strictObject({
      connectionGeneration: z.number().int().positive(),
      staleProfileIds: z.array(identityString).max(10_000),
    }),
    output: serviceExecutionHostSnapshotSchema,
  },
  handleFrame: {
    input: z.strictObject({
      connectionGeneration: z.number().int().positive(),
      frame: daemonStreamFrameSchema.refine(
        (frame) => executionFrameCodes.has(frame.code),
        "This frame belongs to the connector, not the execution host."
      ),
    }),
    output: empty,
  },
  cancel: {
    input: openMeldDaemonCancelRequestPayloadSchema,
    output: openMeldDaemonCancelPayloadSchema,
  },
  interrupt: {
    input: openMeldDaemonInterruptRequestPayloadSchema,
    output: openMeldDaemonInterruptPayloadSchema,
  },
  executionInput: {
    input: z.strictObject({
      operation: z.enum(["apply", "read"]),
      connectionGeneration: z.number().int().positive(),
      leaseEpoch: z.number().int().positive(),
      request: executionInputRequest,
    }),
    output: executionInputResponse,
  },
  conversationStatus: {
    input: openMeldDaemonConversationExecutionStatusRequestPayloadSchema,
    output: openMeldDaemonConversationExecutionStatusPayloadSchema,
  },
  setEnabled: {
    input: openMeldDaemonSetLocalAgentEnabledRequestPayloadSchema,
    output: openMeldDaemonSetLocalAgentEnabledPayloadSchema,
  },
  reportControllers: {
    input: z.strictObject({ probePolicy: z.enum(["background", "fresh"]) }),
    output: reportResult.extend({
      reportCount: count,
      hasArmedReprobe: z.boolean(),
    }),
  },
  reportConversations: {
    input: empty,
    output: reportResult.extend({ proofCount: count }),
  },
  persistCatalog: {
    input: z.strictObject({ revision: z.number().int().positive() }),
    output: empty,
  },
  syncActivity: {
    input: z.strictObject({ refreshIntegrations: z.boolean().optional() }),
    output: empty,
  },
  beginDrain: {
    input: z.strictObject({ onlyIfIdle: z.literal(true).optional() }),
    output: serviceExecutionHostSnapshotSchema,
  },
  drain: { input: empty, output: serviceExecutionHostSnapshotSchema },
  settleResults: {
    input: empty,
    output: z.strictObject({
      status: z.enum(["acknowledged", "connection_closed", "timeout"]),
    }),
  },
  stop: { input: empty, output: serviceExecutionHostSnapshotSchema },
} as const;

export type ServiceExecutionHostMethod =
  keyof typeof serviceExecutionHostMethods;
export type ServiceExecutionHostArguments<
  M extends ServiceExecutionHostMethod,
> = z.output<(typeof serviceExecutionHostMethods)[M]["input"]>;
export type ServiceExecutionHostInput<M extends ServiceExecutionHostMethod> =
  z.input<(typeof serviceExecutionHostMethods)[M]["input"]>;
export type ServiceExecutionHostOutput<M extends ServiceExecutionHostMethod> =
  z.output<(typeof serviceExecutionHostMethods)[M]["output"]>;

const method = z.enum(
  Object.keys(serviceExecutionHostMethods) as [
    ServiceExecutionHostMethod,
    ...ServiceExecutionHostMethod[],
  ]
);
const envelope = {
  protocol: z.literal(SERVICE_EXECUTION_HOST_PROTOCOL),
  hostInstanceId: z.uuid(),
};

export const serviceExecutionHostRequestSchema = z.strictObject({
  ...envelope,
  requestId: z.uuid(),
  method,
  payload: z.unknown(),
});

export const serviceExecutionHostMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...envelope,
    type: z.literal("reply"),
    requestId: z.uuid(),
    method,
    result: z.discriminatedUnion("ok", [
      z.strictObject({ ok: z.literal(true), payload: z.unknown() }),
      z.strictObject({
        ok: z.literal(false),
        error: z.strictObject({
          code: z.string().min(1).max(256),
          message: z.string().min(1).max(4096),
        }),
      }),
    ]),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("frame"),
    connectionGeneration: z.number().int().positive(),
    frame: daemonStreamFrameSchema.refine(
      (frame) => executionOutputFrameCodes.has(frame.code),
      "The execution host cannot emit connector-owned frames."
    ),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("invalidate"),
    scope: z.enum(["routes", "activity", "execution"]),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("authentication_failure"),
    connectionGeneration: z.number().int().positive().nullable(),
    failure: z.strictObject({
      credentialFingerprint: z.string().min(1).max(256).optional(),
      message: z.string().min(1).max(4096),
      reasonCode: z.string().min(1).max(256),
    }),
  }),
]);

export type ServiceExecutionHostIdentity = z.infer<
  typeof serviceExecutionHostIdentitySchema
>;
export type ServiceExecutionHostSnapshot = z.infer<
  typeof serviceExecutionHostSnapshotSchema
>;
export type ServiceExecutionHostCatalog = z.infer<
  typeof serviceExecutionHostCatalogSchema
>;
export type ServiceExecutionHostRoute = z.infer<
  typeof serviceExecutionHostRouteSchema
>;
export type ProfileWorkingFolderFact = z.infer<
  typeof profileWorkingFolderFactSchema
>;
export type ServiceExecutionHostMessage = z.infer<
  typeof serviceExecutionHostMessageSchema
>;
