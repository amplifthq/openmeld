import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import { buildRuntimeWorkspaceFingerprint } from "@openmeld/local-execution";
import type { LocalDaemonAdapterContainer } from "@openmeld/local-service";
import { applyAcceptedLeases } from "@openmeld/local-service";
import type {
  GetAgentProfilePrimaryBindingResponse,
  LocalRuntimeExpectedRoute,
  LocalRuntimeExpectedRouteExclusion,
  ModelCatalog,
  RuntimeTransportRegisterSessionResponse,
} from "@openmeld/schemas/types";
import { resolveCurrentOpenMeldAccountContext } from "../../config/account-context";
import { listOpenMeldProfiles } from "../../config/openmeld-profiles-api";
import type { OpenMeldAccountKey } from "../../config/paths";
import { syncDeviceRuntimeStateProjection } from "../../local-service/reporting/device-runtime-state-sync";
import { resolveCurrentEffectiveProfileWorkingFolderRuntime } from "../../profile-workspace/effective-runtime-resolution";
import type { Presenter } from "../../runtime/presenter/types";
import { ROUTE_CATALOG_LOAD_TIMEOUT_MS } from "../../strategy-constants";
import {
  createExpectedRoutesReadSession,
  type ExpectedRoutesReadResult,
  type ExpectedRoutesReadSession,
} from "../../system/expected-routes-read-session";
import {
  createModelCatalogReadSession,
  type ModelCatalogReadSession,
} from "../../system/model-catalog-read-session";
import {
  createPrimaryBindingReadSession,
  type PrimaryBindingReadSession,
} from "../../system/primary-binding-read-session";
import { syncProfileWorkspaceState } from "../../system/profile-workspace-state";
import { emitRunLine, toErrorMessage } from "../core/logger";
import type {
  DaemonProfileRouteConfig,
  DaemonProfileRouteResolution,
  DaemonProfileSkipReason,
  MutableRouteCatalogState,
  RouteCatalog,
  RouteCatalogDiff,
  RouteCatalogSyncResult,
  SkippedDaemonProfile,
} from "../core/types";
import { DaemonServiceRunError } from "../core/types";
import {
  readLocalEnabledControllers,
  resolveLocalDaemonRouteCandidate,
  resolveLocalRouteCandidateFromBoundTarget,
} from "./resolve-controller-support";

// Phase durations for one catalog load. Callers pass a mutable collector so
// the daemon can journal where startup time actually went instead of
// inferring it from event gaps.
export type RouteCatalogLoadPhaseTimings = {
  accountContextReadMs?: number;
  candidateResolveMs?: number;
  expectedRoutesReadMs?: number;
  modelCatalogReadMs?: number;
  profilesListMs?: number;
  projectionRepairMs?: number;
  workspaceRepairMs?: number;
};

type RouteCatalogLoadPhase =
  | "account_context_read"
  | "candidate_resolve"
  | "expected_routes_read"
  | "local_reply_state_repair"
  | "model_catalog_read";

type RouteCatalogLoadDeadline = {
  run: <T>(
    phase: RouteCatalogLoadPhase,
    operation: () => Promise<T>
  ) => Promise<T>;
};

class RouteCatalogLoadTimeoutError extends Error {
  readonly code = "route_catalog.load_timeout";
  readonly phase: RouteCatalogLoadPhase;

  constructor(input: { phase: RouteCatalogLoadPhase; timeoutMs: number }) {
    super(
      `route catalog load timed out after ${String(input.timeoutMs)}ms during ${input.phase}`
    );
    this.name = "RouteCatalogLoadTimeoutError";
    this.phase = input.phase;
  }
}

type CatalogRouteResolutionEntry = {
  nextResolvedRoute: DaemonProfileRouteResolution;
  profileName: string | null;
};

export async function loadDaemonRouteCatalog(input: {
  allowEmpty?: boolean;
  bindingReads?: PrimaryBindingReadSession;
  expectedRoutesRead?: ExpectedRoutesReadSession;
  localAdapterContainer: LocalDaemonAdapterContainer;
  localReplyStateMode?: "check" | "repair";
  loadTimeoutMs?: number;
  modelCatalogRead?: ModelCatalogReadSession;
  ownerUserId: string;
  phaseTimings?: RouteCatalogLoadPhaseTimings;
  presenter: Presenter;
  quiet?: boolean;
}): Promise<RouteCatalog> {
  const deadline = createRouteCatalogLoadDeadline(
    input.loadTimeoutMs ?? ROUTE_CATALOG_LOAD_TIMEOUT_MS
  );
  // One Core read per operation: the expected-routes projection when the
  // server offers it, otherwise the shared per-profile binding session. The
  // repair-mode device projection consults the same sessions, so repair and
  // catalog resolution never fan out twice.
  const expectedRoutesRead =
    input.expectedRoutesRead ?? createExpectedRoutesReadSession();
  const bindingReads = input.bindingReads ?? createPrimaryBindingReadSession();
  const modelCatalogRead =
    input.modelCatalogRead ?? createModelCatalogReadSession();
  if (input.localReplyStateMode === "repair") {
    await deadline.run("local_reply_state_repair", async () => {
      await repairLocalReplyStateOrThrow({
        bindingReads,
        expectedRoutesRead,
        phaseTimings: input.phaseTimings,
        presenter: input.presenter,
      });
    });
  }
  // A 5xx/network failure here rejects the whole load on purpose: a failed
  // sync keeps the currently registered set instead of shrinking it.
  const expectedRoutesResult = await runMeasuredRouteCatalogLoadPhase({
    deadline,
    operation: () => expectedRoutesRead.read(),
    phase: "expected_routes_read",
    phaseTimings: input.phaseTimings,
    timingKey: "expectedRoutesReadMs",
  });

  const modelCatalog = await runMeasuredRouteCatalogLoadPhase({
    deadline,
    operation: () => modelCatalogRead.read(),
    phase: "model_catalog_read",
    phaseTimings: input.phaseTimings,
    timingKey: "modelCatalogReadMs",
  });

  const account = (
    await runMeasuredRouteCatalogLoadPhase({
      deadline,
      operation: () => resolveCurrentOpenMeldAccountContext(),
      phase: "account_context_read",
      phaseTimings: input.phaseTimings,
      timingKey: "accountContextReadMs",
    })
  ).key;

  const resolutions = await runMeasuredRouteCatalogLoadPhase({
    deadline,
    operation: () =>
      resolveCatalogRouteResolutions({
        account,
        bindingReads,
        expectedRoutesResult,
        localAdapterContainer: input.localAdapterContainer,
        modelCatalog,
        ownerUserId: input.ownerUserId,
        phaseTimings: input.phaseTimings,
      }),
    phase: "candidate_resolve",
    phaseTimings: input.phaseTimings,
    timingKey: "candidateResolveMs",
  });

  const routeByProfileId = new Map<string, DaemonProfileRouteConfig>();
  const skippedProfiles: SkippedDaemonProfile[] = [];
  const workingFolderObservations: NonNullable<
    RouteCatalog["workingFolderObservations"]
  > = [];
  for (const { nextResolvedRoute, profileName } of resolutions) {
    if (nextResolvedRoute.workingFolderObservation) {
      workingFolderObservations.push(
        nextResolvedRoute.workingFolderObservation
      );
    }
    if (nextResolvedRoute.status === "skipped") {
      if (nextResolvedRoute.profileId && nextResolvedRoute.skipReason) {
        skippedProfiles.push({
          profileId: nextResolvedRoute.profileId,
          profileName,
          skipReason: nextResolvedRoute.skipReason,
        });
      }
      if (
        !(
          input.quiet ||
          !nextResolvedRoute.profileId ||
          !nextResolvedRoute.skipReason
        )
      ) {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.profile_skipped",
          text: `skip profile ${nextResolvedRoute.profileId}: ${formatDaemonProfileSkipReason(
            nextResolvedRoute.skipReason
          )}`,
        });
      }
      continue;
    }
    routeByProfileId.set(nextResolvedRoute.profileId, nextResolvedRoute.route);
  }

  const catalog: RouteCatalog = {
    ...resolveV4RouteCatalogMetadata(expectedRoutesResult),
    profileIds: Array.from(routeByProfileId.keys()).sort((left, right) =>
      left.localeCompare(right)
    ),
    routeByProfileId,
    skippedProfiles: skippedProfiles.sort((left, right) =>
      left.profileId.localeCompare(right.profileId)
    ),
    workingFolderObservations: workingFolderObservations.sort((left, right) =>
      left.profileId.localeCompare(right.profileId)
    ),
  };
  if (input.allowEmpty === false && catalog.profileIds.length === 0) {
    throw new DaemonServiceRunError({
      code: "daemon.run.no_eligible_profiles",
      message:
        "no eligible local agent profiles for daemon run; enable agent controllers and bind agent profiles first",
    });
  }
  return catalog;
}

async function resolveCatalogRouteResolutions(input: {
  account: OpenMeldAccountKey;
  bindingReads: PrimaryBindingReadSession;
  expectedRoutesResult: ExpectedRoutesReadResult;
  localAdapterContainer: LocalDaemonAdapterContainer;
  modelCatalog: ModelCatalog;
  ownerUserId: string;
  phaseTimings?: RouteCatalogLoadPhaseTimings;
}): Promise<CatalogRouteResolutionEntry[]> {
  if (
    input.expectedRoutesResult.status === "resolved" &&
    input.expectedRoutesResult.contractVersion === "v4"
  ) {
    return await resolveExpectedRouteResolutions({
      account: input.account,
      excludedProfiles: input.expectedRoutesResult.response.excludedProfiles,
      expectedRoutes: input.expectedRoutesResult.response.expectedRoutes,
      localAdapterContainer: input.localAdapterContainer,
      modelCatalog: input.modelCatalog,
    });
  }
  return await resolvePerProfileBindingResolutions({
    account: input.account,
    bindingReads: input.bindingReads,
    localAdapterContainer: input.localAdapterContainer,
    modelCatalog: input.modelCatalog,
    ownerUserId: input.ownerUserId,
    phaseTimings: input.phaseTimings,
  });
}

function resolveV4RouteCatalogMetadata(
  expectedRoutesResult: ExpectedRoutesReadResult
): Pick<
  RouteCatalog,
  "expectedRoutesContractVersion" | "workingFolderExpectedProfileIds"
> {
  if (
    expectedRoutesResult.status !== "resolved" ||
    expectedRoutesResult.contractVersion !== "v4"
  ) {
    return {};
  }
  return {
    expectedRoutesContractVersion: "v4",
    workingFolderExpectedProfileIds:
      expectedRoutesResult.response.expectedRoutes
        .map((route) => route.agentProfileId)
        .sort((left, right) => left.localeCompare(right)),
  };
}

async function runMeasuredRouteCatalogLoadPhase<T>(input: {
  deadline: RouteCatalogLoadDeadline;
  operation: () => Promise<T>;
  phase: RouteCatalogLoadPhase;
  phaseTimings?: RouteCatalogLoadPhaseTimings;
  timingKey: keyof RouteCatalogLoadPhaseTimings;
}): Promise<T> {
  const startedAt = Date.now();
  try {
    return await input.deadline.run(input.phase, input.operation);
  } finally {
    if (input.phaseTimings) {
      input.phaseTimings[input.timingKey] = Date.now() - startedAt;
    }
  }
}

function createRouteCatalogLoadDeadline(
  timeoutMs: number
): RouteCatalogLoadDeadline {
  const normalizedTimeoutMs = Math.max(1, Math.trunc(timeoutMs));
  const deadlineAtMs = Date.now() + normalizedTimeoutMs;

  return {
    run: async <T>(
      phase: RouteCatalogLoadPhase,
      operation: () => Promise<T>
    ): Promise<T> => {
      const remainingMs = Math.max(0, deadlineAtMs - Date.now());
      if (remainingMs === 0) {
        throw new RouteCatalogLoadTimeoutError({
          phase,
          timeoutMs: normalizedTimeoutMs,
        });
      }

      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new RouteCatalogLoadTimeoutError({
              phase,
              timeoutMs: normalizedTimeoutMs,
            })
          );
        }, remainingMs);
        timer.unref?.();
      });
      try {
        return await Promise.race([operation(), timeout]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    },
  };
}

// Fast path: the server already decided binding eligibility (enabled_primary,
// active agent profile, THIS runtime); only the local half remains. Server
// exclusions map onto existing skip reasons where they describe a local-agent
// condition; other-runtime bindings are simply not this device's routes.
async function resolveExpectedRouteResolutions(input: {
  account: OpenMeldAccountKey;
  excludedProfiles: LocalRuntimeExpectedRouteExclusion[];
  expectedRoutes: LocalRuntimeExpectedRoute[];
  localAdapterContainer: LocalDaemonAdapterContainer;
  modelCatalog: ModelCatalog;
}): Promise<CatalogRouteResolutionEntry[]> {
  const localControllers = await readLocalEnabledControllers();
  const resolved = await Promise.all(
    input.expectedRoutes.map(async (expectedRoute) => {
      if (
        expectedRoute.configurationRevision === undefined ||
        !Object.hasOwn(expectedRoute, "defaultProjectId")
      ) {
        throw new Error(
          `expected-routes v4 response omitted current working-folder identity for ${expectedRoute.agentProfileId}`
        );
      }
      const parsedRef = parseAgentControllerRef(
        expectedRoute.executionTarget.agentControllerRef
      );
      const localResolution = parsedRef
        ? resolveLocalRouteCandidateFromBoundTarget({
            boundTarget: {
              agentControllerConversationId:
                expectedRoute.executionTarget.agentControllerConversationId,
              agentControllerRef: parsedRef.ref,
              openMeldServiceRuntimeId:
                expectedRoute.executionTarget.openMeldServiceRuntimeId,
              bindingId: expectedRoute.bindingId,
              configurationRevision: expectedRoute.configurationRevision,
              agentControllerCollaborationMode:
                expectedRoute.agentControllerCollaborationMode,
              agentControllerPermissionMode:
                expectedRoute.agentControllerPermissionMode,
              ...(expectedRoute.modelSelection
                ? { modelSelection: expectedRoute.modelSelection }
                : {}),
              ...(expectedRoute.openCodePermission
                ? { openCodePermission: expectedRoute.openCodePermission }
                : {}),
              profileId: expectedRoute.agentProfileId,
            },
            localAdapterContainer: input.localAdapterContainer,
            localControllers,
            modelCatalog: input.modelCatalog,
          })
        : ({
            profileId: expectedRoute.agentProfileId,
            skipReason: "controller.binding.incomplete",
            status: "skipped",
          } satisfies DaemonProfileRouteResolution);
      const nextResolvedRoute = await resolveCatalogRouteWorkspaceState({
        account: input.account,
        bindingId: expectedRoute.bindingId,
        configurationRevision: expectedRoute.configurationRevision,
        defaultProjectId: expectedRoute.defaultProjectId ?? null,
        routeResolution: localResolution,
        profileId: expectedRoute.agentProfileId,
      });
      return {
        nextResolvedRoute,
        profileName: expectedRoute.profileName,
      };
    })
  );

  const exclusionEntries: CatalogRouteResolutionEntry[] = [];
  for (const excluded of input.excludedProfiles) {
    if (excluded.reasonCode === "binding.other_runtime") {
      continue;
    }
    exclusionEntries.push({
      nextResolvedRoute: {
        profileId: excluded.agentProfileId,
        skipReason:
          excluded.reasonCode === "profile.inactive"
            ? "profile.status.inactive"
            : "controller.binding.disabled",
        status: "skipped",
      },
      profileName: null,
    });
  }

  return [...resolved, ...exclusionEntries];
}

// Fallback for servers without the expected-routes projection: enumerate the
// owner's profiles and read each primary binding through the shared session.
async function resolvePerProfileBindingResolutions(input: {
  account: OpenMeldAccountKey;
  bindingReads: PrimaryBindingReadSession;
  localAdapterContainer: LocalDaemonAdapterContainer;
  modelCatalog: ModelCatalog;
  ownerUserId: string;
  phaseTimings?: RouteCatalogLoadPhaseTimings;
}): Promise<CatalogRouteResolutionEntry[]> {
  const profilesListStartedAt = Date.now();
  const localControllers = await readLocalEnabledControllers();
  const profiles = await listOpenMeldProfiles();
  if (input.phaseTimings) {
    input.phaseTimings.profilesListMs = Date.now() - profilesListStartedAt;
  }

  return await Promise.all(
    profiles.map(async (profile) => {
      const profileName = normalizeSkippedProfileName(profile.profileName);
      const primaryBindingResult = await readPrimaryBindingForRouteCatalog({
        bindingReads: input.bindingReads,
        profile,
      });
      if (primaryBindingResult.status === "skipped") {
        return {
          nextResolvedRoute: {
            profileId: profile.openMeldProfileId,
            skipReason: primaryBindingResult.skipReason,
            status: "skipped",
          } satisfies DaemonProfileRouteResolution,
          profileName,
        };
      }
      const resolvedRoute = resolveLocalDaemonRouteCandidate({
        localAdapterContainer: input.localAdapterContainer,
        localControllers,
        modelCatalog: input.modelCatalog,
        ownerUserId: input.ownerUserId,
        primaryBinding: primaryBindingResult.binding,
        profile,
      });
      const nextResolvedRoute =
        resolvedRoute.status === "accepted"
          ? await resolveCatalogRouteWorkspaceState({
              account: input.account,
              bindingId: resolvedRoute.route.bindingId ?? null,
              configurationRevision:
                resolvedRoute.route.configurationRevision ?? null,
              defaultProjectId: profile.defaultProjectId ?? null,
              routeResolution: resolvedRoute,
              profileId: resolvedRoute.profileId,
            })
          : resolvedRoute;
      return {
        nextResolvedRoute,
        profileName,
      };
    })
  );
}

async function readPrimaryBindingForRouteCatalog(input: {
  bindingReads: PrimaryBindingReadSession;
  profile: Awaited<ReturnType<typeof listOpenMeldProfiles>>[number];
}): Promise<
  | {
      binding: GetAgentProfilePrimaryBindingResponse["binding"] | null;
      status: "ready";
    }
  | {
      skipReason: Extract<
        DaemonProfileSkipReason,
        "profile.binding.read_unavailable"
      >;
      status: "skipped";
    }
> {
  if (input.profile.profileKind !== "agent") {
    return {
      binding: null,
      status: "ready",
    };
  }
  const response = await input.bindingReads.readPrimaryBinding(input.profile);
  if (response.status === "unavailable") {
    return {
      skipReason: "profile.binding.read_unavailable",
      status: "skipped",
    };
  }
  return {
    binding: response.binding,
    status: "ready",
  };
}

async function repairLocalReplyStateOrThrow(input: {
  bindingReads: PrimaryBindingReadSession;
  expectedRoutesRead: ExpectedRoutesReadSession;
  phaseTimings?: RouteCatalogLoadPhaseTimings;
  presenter: Presenter;
}): Promise<void> {
  const projectionRepairStartedAt = Date.now();
  try {
    await syncDeviceRuntimeStateProjection({
      bindingReads: input.bindingReads,
      expectedRoutesRead: input.expectedRoutesRead,
      mode: "repair",
    });
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.projection_sync_failed",
      text: `local projection repair failed before route registration: ${errorMessage}`,
    });
    throw new DaemonServiceRunError({
      code: "daemon.run.projection_sync_failed",
      message: `local projection repair failed before route registration: ${errorMessage}`,
    });
  } finally {
    if (input.phaseTimings) {
      input.phaseTimings.projectionRepairMs =
        Date.now() - projectionRepairStartedAt;
    }
  }

  const workspaceRepairStartedAt = Date.now();
  try {
    await syncProfileWorkspaceState({
      mode: "repair",
    });
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.profile_workspace_sync_failed",
      text: `local profile workspace repair failed before route registration: ${errorMessage}`,
    });
    throw new DaemonServiceRunError({
      code: "daemon.run.profile_workspace_sync_failed",
      message: `local profile workspace repair failed before route registration: ${errorMessage}`,
    });
  } finally {
    if (input.phaseTimings) {
      input.phaseTimings.workspaceRepairMs =
        Date.now() - workspaceRepairStartedAt;
    }
  }
}

export function buildRouteCatalogDiff(input: {
  currentProfileIds: string[];
  nextProfileIds: string[];
}): RouteCatalogDiff {
  const currentProfileIdsSet = new Set(input.currentProfileIds);
  const nextProfileIdsSet = new Set(input.nextProfileIds);
  const addedProfileIds = [...nextProfileIdsSet]
    .filter((profileId) => !currentProfileIdsSet.has(profileId))
    .sort((left, right) => left.localeCompare(right));
  const removedProfileIds = [...currentProfileIdsSet]
    .filter((profileId) => !nextProfileIdsSet.has(profileId))
    .sort((left, right) => left.localeCompare(right));
  const keptProfileIds = [...nextProfileIdsSet]
    .filter((profileId) => currentProfileIdsSet.has(profileId))
    .sort((left, right) => left.localeCompare(right));
  return {
    addedProfileIds,
    keptProfileIds,
    removedProfileIds,
  };
}

export function replaceRouteCatalogMap(input: {
  nextRouteByProfileId: RouteCatalog["routeByProfileId"];
  routeByProfileId: RouteCatalog["routeByProfileId"];
}): void {
  input.routeByProfileId.clear();
  for (const [profileId, routeConfig] of input.nextRouteByProfileId) {
    input.routeByProfileId.set(profileId, routeConfig);
  }
}

export function createMutableRouteCatalogState(
  routeCatalog: RouteCatalog
): MutableRouteCatalogState {
  return {
    ...(routeCatalog.expectedRoutesContractVersion
      ? {
          expectedRoutesContractVersion:
            routeCatalog.expectedRoutesContractVersion,
        }
      : {}),
    fingerprint: buildRouteCatalogFingerprint(routeCatalog),
    profileIds: [...routeCatalog.profileIds],
    routeByProfileId: new Map(routeCatalog.routeByProfileId),
    skippedProfiles: [...routeCatalog.skippedProfiles],
    workingFolderExpectedProfileIds: [
      ...(routeCatalog.workingFolderExpectedProfileIds ?? []),
    ],
    workingFolderObservations: [
      ...(routeCatalog.workingFolderObservations ?? []),
    ],
  };
}

export function createRouteCatalogFromMutableState(
  state: MutableRouteCatalogState
): RouteCatalog {
  return {
    ...(state.expectedRoutesContractVersion
      ? { expectedRoutesContractVersion: state.expectedRoutesContractVersion }
      : {}),
    profileIds: [...state.profileIds],
    routeByProfileId: new Map(state.routeByProfileId),
    skippedProfiles: [...state.skippedProfiles],
    workingFolderExpectedProfileIds: [
      ...(state.workingFolderExpectedProfileIds ?? []),
    ],
    workingFolderObservations: [...(state.workingFolderObservations ?? [])],
  };
}

export async function syncDaemonRouteCatalogState(input: {
  catalogState: MutableRouteCatalogState;
  forceRegister?: boolean;
  leasesByProfileId: Map<string, number>;
  loadCatalog: () => Promise<RouteCatalog>;
  registerCatalog: (
    routeCatalog: RouteCatalog
  ) => Promise<RuntimeTransportRegisterSessionResponse>;
}): Promise<RouteCatalogSyncResult> {
  let nextCatalog: RouteCatalog;
  try {
    nextCatalog = await input.loadCatalog();
  } catch (error) {
    return {
      status: "failed",
      reason: "load_failed",
      errorMessage: toErrorMessage(error),
    };
  }

  const nextFingerprint = buildRouteCatalogFingerprint(nextCatalog);
  if (nextFingerprint === input.catalogState.fingerprint) {
    const shouldRefreshLeases =
      input.forceRegister ||
      nextCatalog.expectedRoutesContractVersion === "v4" ||
      nextCatalog.profileIds.some(
        (profileId) => !input.leasesByProfileId.has(profileId)
      );
    if (shouldRefreshLeases) {
      let registerResponse: RuntimeTransportRegisterSessionResponse;
      try {
        registerResponse = await input.registerCatalog(nextCatalog);
      } catch (error) {
        return {
          status: "failed",
          reason: "register_failed",
          errorMessage: toErrorMessage(error),
        };
      }

      applyAcceptedLeases({
        acceptedLeases: registerResponse.acceptedLeases,
        leasesByProfileId: input.leasesByProfileId,
      });
      replaceRouteCatalogMap({
        routeByProfileId: input.catalogState.routeByProfileId,
        nextRouteByProfileId: nextCatalog.routeByProfileId,
      });
      input.catalogState.profileIds = [...nextCatalog.profileIds];
      input.catalogState.fingerprint = nextFingerprint;
      input.catalogState.skippedProfiles = [...nextCatalog.skippedProfiles];
      input.catalogState.expectedRoutesContractVersion =
        nextCatalog.expectedRoutesContractVersion;
      input.catalogState.workingFolderExpectedProfileIds = [
        ...(nextCatalog.workingFolderExpectedProfileIds ?? []),
      ];
      input.catalogState.workingFolderObservations = [
        ...(nextCatalog.workingFolderObservations ?? []),
      ];
      return {
        registerResponse,
        skippedProfiles: nextCatalog.skippedProfiles,
        status: "registered",
      };
    }
    input.catalogState.skippedProfiles = [...nextCatalog.skippedProfiles];
    input.catalogState.expectedRoutesContractVersion =
      nextCatalog.expectedRoutesContractVersion;
    input.catalogState.workingFolderExpectedProfileIds = [
      ...(nextCatalog.workingFolderExpectedProfileIds ?? []),
    ];
    input.catalogState.workingFolderObservations = [
      ...(nextCatalog.workingFolderObservations ?? []),
    ];
    return {
      skippedProfiles: nextCatalog.skippedProfiles,
      status: "unchanged",
    };
  }

  let registerResponse: RuntimeTransportRegisterSessionResponse;
  try {
    registerResponse = await input.registerCatalog(nextCatalog);
  } catch (error) {
    return {
      status: "failed",
      reason: "register_failed",
      errorMessage: toErrorMessage(error),
    };
  }

  const diff = buildRouteCatalogDiff({
    currentProfileIds: input.catalogState.profileIds,
    nextProfileIds: nextCatalog.profileIds,
  });

  applyAcceptedLeases({
    acceptedLeases: registerResponse.acceptedLeases,
    leasesByProfileId: input.leasesByProfileId,
  });
  replaceRouteCatalogMap({
    routeByProfileId: input.catalogState.routeByProfileId,
    nextRouteByProfileId: nextCatalog.routeByProfileId,
  });
  input.catalogState.profileIds = [...nextCatalog.profileIds];
  input.catalogState.fingerprint = nextFingerprint;
  input.catalogState.skippedProfiles = [...nextCatalog.skippedProfiles];
  input.catalogState.expectedRoutesContractVersion =
    nextCatalog.expectedRoutesContractVersion;
  input.catalogState.workingFolderExpectedProfileIds = [
    ...(nextCatalog.workingFolderExpectedProfileIds ?? []),
  ];
  input.catalogState.workingFolderObservations = [
    ...(nextCatalog.workingFolderObservations ?? []),
  ];
  return {
    status: "changed",
    diff,
    registerResponse,
    skippedProfiles: nextCatalog.skippedProfiles,
  };
}

export function summarizeSkippedDaemonProfiles(
  skippedProfiles: SkippedDaemonProfile[]
): string {
  if (skippedProfiles.length === 0) {
    return "none";
  }
  const preview = skippedProfiles
    .slice(0, 3)
    .map((profile) => {
      const displayName = profile.profileName ?? profile.profileId;
      return `${displayName} (${profile.profileId}): ${formatDaemonProfileSkipReason(
        profile.skipReason
      )}`;
    })
    .join("; ");
  const remainingCount = skippedProfiles.length - 3;
  if (remainingCount <= 0) {
    return preview;
  }
  return `${preview}; +${String(remainingCount)} more`;
}

async function resolveCatalogRouteWorkspaceState(input: {
  account: OpenMeldAccountKey;
  bindingId: string | null;
  configurationRevision: number | null;
  defaultProjectId: string | null;
  profileId: string;
  routeResolution: DaemonProfileRouteResolution;
}): Promise<
  Extract<DaemonProfileRouteResolution, { status: "accepted" | "skipped" }>
> {
  const workspace = await resolveCurrentEffectiveProfileWorkingFolderRuntime({
    account: input.account,
    defaultProjectId: input.defaultProjectId,
    openMeldProfileId: input.profileId,
    mode: "inspect",
  });
  const workingFolderObservation = buildWorkingFolderObservation({
    bindingId: input.bindingId,
    configurationRevision: input.configurationRevision,
    profileId: input.profileId,
    workspace,
  });
  if (input.routeResolution.status === "skipped") {
    return {
      ...input.routeResolution,
      workingFolderObservation,
    };
  }
  if (workspace.status === "missing") {
    return {
      profileId: input.profileId,
      skipReason: "workspace.missing",
      status: "skipped",
      workingFolderObservation,
    };
  }
  if (workspace.status === "invalid") {
    return {
      profileId: input.profileId,
      skipReason: "workspace.invalid",
      status: "skipped",
      workingFolderObservation,
    };
  }

  return {
    profileId: input.profileId,
    route: {
      ...input.routeResolution.route,
      workingFolderRuntime: workspace,
    },
    status: "accepted",
    workingFolderObservation,
  };
}

function buildWorkingFolderObservation(input: {
  bindingId: string | null;
  configurationRevision: number | null;
  profileId: string;
  workspace: Awaited<
    ReturnType<typeof resolveCurrentEffectiveProfileWorkingFolderRuntime>
  >;
}) {
  return {
    ...input.workspace.workingFolderFact,
    bindingId: input.bindingId,
    configurationRevision: input.configurationRevision,
    profileId: input.profileId,
  };
}

function formatDaemonProfileSkipReason(
  skipReason: DaemonProfileSkipReason
): string {
  switch (skipReason) {
    case "projection.missing":
      return "local device runtime projection is missing";
    case "controller.registry.disabled":
      return "controller is disabled in the local agents registry";
    case "controller.launch.needs_repair":
      return "controller launch needs repair on this device";
    case "runtime.adapter.unsupported":
      return "local runtime adapter support is missing on this device";
    case "controller.binding.disabled":
      return "controller binding is disabled";
    case "controller.binding.incomplete":
      return "controller binding metadata is incomplete";
    case "profile.status.inactive":
      return "profile is not active";
    case "profile.binding.read_unavailable":
      return "profile binding could not be read";
    case "profile.binding.unbound":
      return "profile binding is not bound";
    case "workspace.missing":
      return "local profile workspace is missing";
    case "workspace.invalid":
      return "local profile workspace is invalid";
    default:
      return skipReason;
  }
}

function normalizeSkippedProfileName(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildRouteCatalogFingerprint(routeCatalog: RouteCatalog): string {
  const entries = routeCatalog.profileIds.map((profileId) => {
    const route = routeCatalog.routeByProfileId.get(profileId);
    return {
      profileId,
      bindingId: route?.bindingId ?? null,
      configurationRevision: route?.configurationRevision ?? null,
      openMeldServiceRuntimeId: route?.openMeldServiceRuntimeId ?? null,
      agentControllerRef: route?.agentControllerRef ?? null,
      agentControllerConversationId:
        route?.agentControllerConversationId ?? null,
      agentControllerPermissionMode:
        route?.agentControllerPermissionMode ?? null,
      conversationPolicy: route?.conversationPolicy ?? null,
      openCodePermission: route?.openCodePermission ?? null,
      streamingMode: route?.streamingMode ?? null,
      transportMode: route?.transportMode ?? null,
      contextIdMappingSpec: route?.contextIdMappingSpec
        ? {
            sourceField: route.contextIdMappingSpec.sourceField,
            mappingVersion: route.contextIdMappingSpec.mappingVersion,
          }
        : null,
      workingFolderFact: route?.workingFolderRuntime?.workingFolderFact
        ? {
            defaultProjectId:
              route.workingFolderRuntime.workingFolderFact.defaultProjectId,
            localProjectBindingGeneration:
              route.workingFolderRuntime.workingFolderFact
                .localProjectBindingGeneration,
            source: route.workingFolderRuntime.workingFolderFact.source,
            status: route.workingFolderRuntime.workingFolderFact.status,
          }
        : null,
      workingFolderPathFingerprint: route?.workingFolderRuntime
        ?.effectiveRuntimeWorkingDirectory
        ? buildRuntimeWorkspaceFingerprint(
            route.workingFolderRuntime.effectiveRuntimeWorkingDirectory
          )
        : null,
    };
  });
  const skippedProfiles = routeCatalog.skippedProfiles.map((profile) => ({
    profileId: profile.profileId,
    profileName: profile.profileName,
    skipReason: profile.skipReason,
  }));
  const workingFolderObservations = (
    routeCatalog.workingFolderObservations ?? []
  ).map((observation) => ({
    bindingId: observation.bindingId,
    configurationRevision: observation.configurationRevision,
    defaultProjectId: observation.defaultProjectId,
    localProjectBindingGeneration: observation.localProjectBindingGeneration,
    profileId: observation.profileId,
    reasonCode: observation.reasonCode,
    source: observation.source,
    status: observation.status,
  }));
  return JSON.stringify({
    entries,
    expectedRoutesContractVersion:
      routeCatalog.expectedRoutesContractVersion ?? null,
    skippedProfiles,
    workingFolderExpectedProfileIds:
      routeCatalog.workingFolderExpectedProfileIds ?? [],
    workingFolderObservations,
  });
}
