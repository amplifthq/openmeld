import pc from "picocolors";
import { resolveAuthenticationGuidance } from "../auth/auth-guidance";
import {
  type AuthSessionState,
  getAuthSessionState,
} from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import { getDaemonStatus } from "../config/daemon-state";
import { getSelectedOpenMeldProfileId } from "../config/openmeld-profile-selection";
import {
  listOpenMeldProfiles,
  type OpenMeldProfile,
} from "../config/openmeld-profiles-api";
import { resolveOpenMeldProfileOrNull } from "../config/resolve-openmeld-profile";
import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import {
  type DaemonServiceFreshnessWarning,
  resolveDaemonServiceFreshnessWarning,
} from "../local-service/lifecycle/daemon-service-freshness";
import { inspectDaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import { readCurrentDaemonRuntimeContext } from "../local-service/lifecycle/daemon-service-runtime";
import { shouldEmitAgentOverview } from "../runtime/agent-overview-output";
import {
  buildAgentProfileRuntimeData,
  buildAgentProfileRuntimeRows,
  buildAgentProfileStateData,
  buildAgentProfileStateRows,
  resolveAgentProfileRuntimeState,
} from "../runtime/agent-profile-state";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
  formatOpenMeldCliCommands,
} from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import { toProfileLookupErrorMessage } from "../runtime/profile-lookup-error-message";
import { type InfoCardRow, renderInfoCard } from "../ui/info-card";
import {
  type AuthStatusSnapshot,
  buildAuthStatusRows,
  buildAuthStatusSnapshot,
  formatActiveOrganizationLabel,
} from "./auth-status-shared";
import { emitTopLevelAgentOverview } from "./top-level-agent-overview";

type ProfileMissingGuidance = {
  hint: string;
  nextSteps: string[];
  profilesFound: boolean;
  eligibleProfileCount: number;
};

type ProfileLookupFailureGuidance = {
  summary: string;
  details: string;
  nextSteps: [firstStep: string, retryStep: string];
};

type WhoamiDaemonServiceContext = {
  installed: boolean;
  effectiveRuntimeStatus:
    | "not_installed"
    | "running"
    | "stale"
    | "not_running"
    | "unknown";
  profileId: string | null;
  profileName: string | null;
  serviceController: string | null;
  serviceFreshnessWarning: WhoamiServiceFreshnessWarning | null;
  autoStart: boolean;
};

type WhoamiServiceFreshnessWarning = Pick<
  DaemonServiceFreshnessWarning,
  "anomalyCodes" | "code" | "detailText" | "nextSteps" | "summaryText"
>;

type WhoamiShellProfileContext = {
  profileId: string | null;
  profile: OpenMeldProfile | null;
  lookupFailure: ProfileLookupFailureGuidance | null;
};

type WhoamiProfileAlignment = {
  status:
    | "aligned"
    | "drifted"
    | "no_saved_profiles"
    | "service_profile_not_set"
    | "shell_profile_not_selected"
    | "shell_profile_unavailable";
  summary: string;
  whyItMatters: string | null;
  nextSteps: string[];
  shellSelectedProfileId: string | null;
  serviceProfileId: string | null;
};

const HUMAN_PROFILE_AVATAR = "👤";
const AGENT_PROFILE_AVATAR = "🤖";

export async function runWhoami(input: {
  profile?: string;
  view?: string;
  agentOverviewHandled?: boolean;
}) {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  if (
    shouldEmitAgentOverview({
      resolvedView: runtime.resolvedView,
      handled: input.agentOverviewHandled,
    })
  ) {
    emitTopLevelAgentOverview({
      presenter,
      command: "whoami",
    });
  }
  const authSessionState = await getAuthSessionState({
    validateRemote: true,
  });
  const authSnapshot = buildAuthStatusSnapshot(authSessionState);
  const hasExplicitProfile = String(input.profile ?? "").trim().length > 0;
  let openMeldProfileLookupError: unknown = null;
  const openMeldProfile =
    authSessionState.state === "valid"
      ? await resolveOpenMeldProfileOrNull({
          openMeldProfileId: input.profile,
          allowUnauthenticated: false,
          allowDefaultFallback: false,
          // whoami reports the current explicit/session profile only.
          persistSelection: !hasExplicitProfile,
        }).catch((error: unknown) => {
          openMeldProfileLookupError = error;
          return null;
        })
      : null;
  const openMeldProfileForOutput = openMeldProfile;
  const gatewayUrl = await resolveBaseUrl();
  const shellProfileContext = await resolveWhoamiShellProfileContext({
    activeCommandProfile: openMeldProfileForOutput,
    authState: authSnapshot.state,
    resolvedView: runtime.resolvedView,
  });
  const daemonServiceContext = await resolveWhoamiDaemonServiceContext({
    activeCommandProfile: openMeldProfileForOutput,
    shellSelectedProfile: shellProfileContext.profile,
  });
  const profileAlignment = resolveWhoamiProfileAlignment({
    activeCommandProfile: openMeldProfileForOutput,
    daemonServiceContext,
    resolvedView: runtime.resolvedView,
    shellProfileContext,
  });
  const profileResolutionGuidance =
    await resolveWhoamiProfileResolutionGuidance({
      openMeldProfile: openMeldProfileForOutput,
      authState: authSnapshot.state,
      openMeldProfileLookupError,
      resolvedView: runtime.resolvedView,
    });
  const agentRuntimeState =
    openMeldProfileForOutput === null
      ? null
      : await resolveAgentProfileRuntimeState(openMeldProfileForOutput, {
          includeDaemonRouteObservation: true,
        });
  const humanDataMode = runtime.viewCustomization?.render?.human?.dataMode;
  process.exitCode = authSessionState.state === "valid" ? 0 : 1;

  if (runtime.resolvedView === "human" && humanDataMode !== "envelope") {
    renderInfoCard({
      presenter,
      title: "Authentication Status",
      codePrefix: "whoami.auth.card",
      rows: await buildWhoamiHumanRows({
        auth: authSnapshot,
        openMeldProfile: openMeldProfileForOutput,
        daemonServiceContext,
        profileAlignment,
        profileGuidance: profileResolutionGuidance,
        shellProfileContext,
        activeProfileSource: hasExplicitProfile ? "explicit" : "selected",
        agentRuntimeState,
      }),
    });
    return;
  }

  presenter.event("info", "whoami.loaded", {
    profile:
      openMeldProfileForOutput?.openMeldProfileId ?? input.profile ?? "unknown",
  });
  presenter.data({
    code: "whoami.openmeld_profile",
    payload: openMeldProfileForOutput ?? null,
  });
  presenter.data({
    code: "whoami.auth",
    payload: authSnapshot,
  });
  presenter.data({
    code: "whoami.context",
    payload: {
      gatewayUrl,
      authAccount: authSnapshot,
      organization: {
        active: authSnapshot.activeOrganization,
      },
      selectedProfile: openMeldProfileForOutput ?? null,
      selectedShellProfile: shellProfileContext.profile ?? null,
      selectedShellProfileId: shellProfileContext.profileId,
      daemonServiceContext,
      profileAlignment,
      ...(openMeldProfileForOutput?.profileKind === "agent"
        ? {
            agentProfileState: buildAgentProfileStateData(
              openMeldProfileForOutput
            ),
            agentProfileRuntime:
              buildAgentProfileRuntimeData(agentRuntimeState),
          }
        : {}),
    },
  });
  if (!openMeldProfileForOutput) {
    if (profileResolutionGuidance.lookupFailure) {
      presenter.data({
        code: "whoami.profile_lookup_failed",
        payload: profileResolutionGuidance.lookupFailure,
      });
    } else {
      presenter.data({
        code: "whoami.profile_missing",
        payload: profileResolutionGuidance.missing,
      });
    }
  }
}

async function buildWhoamiHumanRows(input: {
  auth: AuthStatusSnapshot;
  openMeldProfile: OpenMeldProfile | null;
  daemonServiceContext: WhoamiDaemonServiceContext;
  profileAlignment: WhoamiProfileAlignment;
  profileGuidance: {
    missing: ProfileMissingGuidance | null;
    lookupFailure: ProfileLookupFailureGuidance | null;
  };
  shellProfileContext: WhoamiShellProfileContext;
  activeProfileSource: "explicit" | "selected";
  agentRuntimeState: Awaited<
    ReturnType<typeof resolveAgentProfileRuntimeState>
  >;
}): Promise<InfoCardRow[]> {
  const authRows = buildAuthStatusRows(input.auth);
  if (input.auth.state !== "valid") {
    return authRows;
  }

  const primaryAuthRows = buildSignedInAccountRows(input.auth);
  const profileRows = await resolveWhoamiProfileRows({
    openMeldProfile: input.openMeldProfile,
    activeProfileSource: input.activeProfileSource,
    agentRuntimeState: input.agentRuntimeState,
    profileGuidance: input.profileGuidance,
    shellProfileContext: input.shellProfileContext,
  });
  const daemonRows = buildDaemonServiceContextRows({
    openMeldProfile: input.openMeldProfile,
    daemonServiceContext: input.daemonServiceContext,
    profileAlignment: input.profileAlignment,
  });

  return [
    ...primaryAuthRows,
    ...appendCardRowGap({
      currentRows: primaryAuthRows,
      nextRows: profileRows,
    }),
    ...profileRows,
    ...appendCardRowGap({
      currentRows: profileRows,
      nextRows: daemonRows,
    }),
    ...daemonRows,
  ];
}

function formatDimmedWhoamiRow(row: InfoCardRow): InfoCardRow {
  return {
    label: pc.dim(row.label),
    value: pc.dim(row.value),
  };
}

async function buildResolvedWhoamiProfileRows(input: {
  openMeldProfile: OpenMeldProfile;
  activeProfileSource: "explicit" | "selected";
  shellProfileContext: WhoamiShellProfileContext;
  agentRuntimeState: Awaited<
    ReturnType<typeof resolveAgentProfileRuntimeState>
  >;
}): Promise<InfoCardRow[]> {
  const openMeldProfile = input.openMeldProfile;
  const ownerName = String(openMeldProfile.ownerName ?? "").trim();
  const stateRows = await resolveWhoamiAgentProfileStateRows(openMeldProfile);
  const rows: InfoCardRow[] = [
    {
      label: "Command Profile",
      value: formatHighlightedProfileName({
        profileKind: openMeldProfile.profileKind,
        profileName: openMeldProfile.profileName,
      }),
    },
    ...(input.activeProfileSource === "explicit"
      ? [
          formatDimmedWhoamiRow({
            label: "Command Source",
            value: "--profile",
          }),
        ]
      : []),
    ...buildShellSelectedProfileRows({
      activeCommandProfile: openMeldProfile,
      activeProfileSource: input.activeProfileSource,
      shellProfileContext: input.shellProfileContext,
    }),
    {
      label: "Profile Type",
      value: formatHighlightedProfileType(openMeldProfile.profileKind),
    },
    { label: "Profile ID", value: openMeldProfile.openMeldProfileId },
    ...(ownerName
      ? [formatDimmedWhoamiRow({ label: "Profile Owner", value: ownerName })]
      : []),
    ...stateRows,
    ...buildAgentProfileRuntimeRows(input.agentRuntimeState),
  ];
  return rows;
}

async function resolveWhoamiProfileRows(input: {
  openMeldProfile: OpenMeldProfile | null;
  activeProfileSource: "explicit" | "selected";
  profileGuidance: {
    missing: ProfileMissingGuidance | null;
    lookupFailure: ProfileLookupFailureGuidance | null;
  };
  shellProfileContext: WhoamiShellProfileContext;
  agentRuntimeState: Awaited<
    ReturnType<typeof resolveAgentProfileRuntimeState>
  >;
}): Promise<InfoCardRow[]> {
  if (input.openMeldProfile) {
    return await buildResolvedWhoamiProfileRows({
      openMeldProfile: input.openMeldProfile,
      activeProfileSource: input.activeProfileSource,
      agentRuntimeState: input.agentRuntimeState,
      shellProfileContext: input.shellProfileContext,
    });
  }

  if (input.profileGuidance.lookupFailure) {
    return buildUnavailableWhoamiProfileRows(
      input.profileGuidance.lookupFailure
    );
  }

  return buildMissingWhoamiProfileRows(input.profileGuidance.missing);
}

function buildMissingWhoamiProfileRows(
  guidance: ProfileMissingGuidance | null
): InfoCardRow[] {
  const rows: InfoCardRow[] = [
    {
      label: "Selected Shell Profile",
      value: pc.bold(pc.yellow("not selected yet")),
    },
    {
      label: "Why it matters",
      value:
        "OpenMeld uses a profile to know which person or agent this command should use.",
    },
  ];

  if (guidance?.profilesFound) {
    rows.push({
      label: "Next step",
      value: formatInlineOpenMeldCliCommands(
        "Run `openmeld profiles set <profile-id>` to choose a profile."
      ),
    });
    rows.push({
      label: "Shortcut",
      value: formatInlineOpenMeldCliCommands(
        "Or run `openmeld whoami --profile <profile-id>` for this command only."
      ),
    });
    return rows;
  }

  const firstLookupStep = guidance?.nextSteps?.[0];
  const needsProfileList =
    typeof firstLookupStep === "string" &&
    firstLookupStep.startsWith("openmeld profiles list");
  if (needsProfileList) {
    rows.push({
      label: "Next step",
      value: formatInlineOpenMeldCliCommands(
        "Run `openmeld profiles list` to load your profiles."
      ),
    });
    rows.push({
      label: "Shortcut",
      value: formatInlineOpenMeldCliCommands(
        "Then run `openmeld profiles set <profile-id>` to choose one."
      ),
    });
    return rows;
  }

  rows.push({
    label: "Next step",
    value: formatInlineOpenMeldCliCommands(
      "Run `openmeld start` to choose or create a profile."
    ),
  });
  rows.push({
    label: "Shortcut",
    value: formatInlineOpenMeldCliCommands(
      "Or run `openmeld profiles create <profile-name>` to create one directly."
    ),
  });
  return rows;
}

function buildUnavailableWhoamiProfileRows(
  guidance: ProfileLookupFailureGuidance
): InfoCardRow[] {
  const [firstStep] = guidance.nextSteps;
  return [
    {
      label: "Selected Shell Profile",
      value: pc.bold(pc.yellow("temporarily unavailable")),
    },
    {
      label: "What happened",
      value: guidance.summary,
    },
    {
      label: "Next",
      value: formatInlineOpenMeldCliCommands(`Run \`${firstStep}\` first.`),
    },
  ];
}

function appendCardRowGap(input: {
  currentRows: InfoCardRow[];
  nextRows: InfoCardRow[];
}): InfoCardRow[] {
  if (input.currentRows.length === 0 || input.nextRows.length === 0) {
    return [];
  }
  return [{ label: "", value: "" }];
}

function buildSignedInAccountRows(auth: AuthStatusSnapshot): InfoCardRow[] {
  const rows: InfoCardRow[] = [
    {
      label: "Signed-in Account",
      value: pc.bold(pc.cyan(buildSignedInAccountLabel(auth))),
    },
  ];

  if (auth.userId) {
    rows.push(
      formatDimmedWhoamiRow({
        label: "Account ID",
        value: auth.userId,
      })
    );
  }
  rows.push({
    label: "Active Organization",
    value: auth.activeOrganization
      ? formatActiveOrganizationLabel(auth.activeOrganization)
      : "not selected",
  });

  return rows;
}

function buildSignedInAccountLabel(auth: AuthStatusSnapshot): string {
  const name = String(auth.userName ?? "").trim();
  const email = String(auth.userEmail ?? "").trim();
  if (name && email) {
    return `${name} <${email}>`;
  }
  return name || email || "signed in";
}

function buildDaemonServiceContextRows(input: {
  openMeldProfile: OpenMeldProfile | null;
  daemonServiceContext: WhoamiDaemonServiceContext;
  profileAlignment: WhoamiProfileAlignment;
}): InfoCardRow[] {
  const highlightedServiceProfileName =
    input.daemonServiceContext.profileName &&
    input.daemonServiceContext.profileId &&
    input.openMeldProfile?.openMeldProfileId ===
      input.daemonServiceContext.profileId
      ? formatHighlightedProfileName({
          profileKind: input.openMeldProfile.profileKind,
          profileName: input.daemonServiceContext.profileName,
        })
      : null;
  const rows: InfoCardRow[] = [
    {
      label: "Daemon Service Context",
      value: formatDaemonServiceContextStatus(
        input.daemonServiceContext.effectiveRuntimeStatus
      ),
    },
    {
      label: "OpenMeld Service Profile",
      value:
        highlightedServiceProfileName ??
        input.daemonServiceContext.profileName ??
        input.daemonServiceContext.profileId ??
        pc.dim("not set"),
    },
    {
      label: "Profile Alignment",
      value: formatProfileAlignmentSummary(input.profileAlignment),
    },
    ...(input.profileAlignment.whyItMatters
      ? [
          {
            label: "Why it matters",
            value: input.profileAlignment.whyItMatters,
          },
        ]
      : []),
    ...(input.profileAlignment.nextSteps[0]
      ? [
          {
            label: "Next step",
            value: formatInlineOpenMeldCliCommands(
              `Run \`${input.profileAlignment.nextSteps[0]}\`.`
            ),
          },
        ]
      : []),
    ...(input.profileAlignment.nextSteps[1]
      ? [
          {
            label: "Shortcut",
            value: formatInlineOpenMeldCliCommands(
              `Or run \`${input.profileAlignment.nextSteps[1]}\`.`
            ),
          },
        ]
      : []),
  ];

  if (input.daemonServiceContext.serviceController) {
    rows.push(
      formatDimmedWhoamiRow({
        label: "Service Controller",
        value: input.daemonServiceContext.serviceController,
      })
    );
  }

  if (input.daemonServiceContext.serviceFreshnessWarning) {
    rows.push({
      label: "Service Freshness",
      value: pc.bold(
        pc.yellow(
          input.daemonServiceContext.serviceFreshnessWarning.summaryText
        )
      ),
    });
    rows.push({
      label: "Why it matters",
      value: input.daemonServiceContext.serviceFreshnessWarning.detailText,
    });
    const firstNextStep =
      input.daemonServiceContext.serviceFreshnessWarning.nextSteps[0];
    if (firstNextStep) {
      rows.push({
        label: "Next step",
        value: formatInlineOpenMeldCliCommands(`Run \`${firstNextStep}\`.`),
      });
    }
  }

  rows.push(
    formatDimmedWhoamiRow({
      label: "Auto Start",
      value: input.daemonServiceContext.autoStart ? "on" : "off",
    })
  );

  return rows;
}

function formatDaemonServiceContextStatus(
  status: WhoamiDaemonServiceContext["effectiveRuntimeStatus"]
): string {
  if (status === "running") {
    return pc.bold(pc.green("running"));
  }
  if (status === "not_installed") {
    return pc.bold(pc.yellow("not installed"));
  }
  if (status === "not_running") {
    return pc.bold(pc.yellow("not running"));
  }
  if (status === "stale") {
    return pc.bold(pc.yellow("stale"));
  }
  return pc.bold(pc.yellow("unknown"));
}

function formatHighlightedProfileName(input: {
  profileKind: OpenMeldProfile["profileKind"];
  profileName: string;
}): string {
  return pc.bold(
    pc.cyan(
      `${resolveWhoamiProfileAvatar(input.profileKind)} ${input.profileName}`
    )
  );
}

function formatHighlightedProfileType(
  profileKind: OpenMeldProfile["profileKind"]
): string {
  return pc.bold(
    `${resolveWhoamiProfileAvatar(profileKind)} ${toWhoamiProfileKindLabel(profileKind)}`
  );
}

function resolveWhoamiProfileAvatar(
  profileKind: OpenMeldProfile["profileKind"]
): string {
  return profileKind === "agent" ? AGENT_PROFILE_AVATAR : HUMAN_PROFILE_AVATAR;
}

function toWhoamiProfileKindLabel(
  profileKind: OpenMeldProfile["profileKind"]
): string {
  return profileKind === "agent" ? "Agent" : "Human";
}

async function resolveWhoamiDaemonServiceContext(input: {
  activeCommandProfile: OpenMeldProfile | null;
  shellSelectedProfile: OpenMeldProfile | null;
}): Promise<WhoamiDaemonServiceContext> {
  const [runtimeContextResult, serviceContractResult, inventoryResult] =
    await Promise.allSettled([
      readCurrentDaemonRuntimeContext(),
      readDaemonServiceContract(),
      inspectDaemonServiceInventory({
        expectedVersion: resolveCurrentDaemonExpectedVersion(),
      }),
    ]);
  const serviceContract =
    serviceContractResult.status === "fulfilled"
      ? serviceContractResult.value
      : null;
  const serviceFreshnessWarning =
    inventoryResult.status === "fulfilled"
      ? toWhoamiServiceFreshnessWarning(
          resolveDaemonServiceFreshnessWarning({
            inventory: inventoryResult.value,
          })
        )
      : null;

  if (runtimeContextResult.status !== "fulfilled") {
    const daemonStatus = await Promise.resolve()
      .then(() => getDaemonStatus())
      .catch(() => null);
    let profileName: string | null = null;
    if (
      serviceContract?.profileId &&
      input.activeCommandProfile?.openMeldProfileId ===
        serviceContract.profileId
    ) {
      profileName = input.activeCommandProfile.profileName;
    } else if (
      serviceContract?.profileId &&
      input.shellSelectedProfile?.openMeldProfileId ===
        serviceContract.profileId
    ) {
      profileName = input.shellSelectedProfile.profileName;
    }
    return {
      installed: false,
      effectiveRuntimeStatus:
        daemonStatus?.installed === false ? "not_installed" : "unknown",
      profileId: serviceContract?.profileId ?? null,
      profileName,
      serviceController: null,
      serviceFreshnessWarning,
      autoStart: false,
    };
  }

  const runtimeContext = runtimeContextResult.value;

  if (!runtimeContext?.status.installed) {
    return {
      installed: false,
      effectiveRuntimeStatus: "not_installed",
      profileId: null,
      profileName: null,
      serviceController: null,
      serviceFreshnessWarning,
      autoStart: false,
    };
  }

  const profileId = serviceContract?.profileId ?? null;
  let profileName: string | null = null;
  if (
    profileId &&
    input.activeCommandProfile?.openMeldProfileId === profileId
  ) {
    profileName = input.activeCommandProfile.profileName;
  } else if (
    profileId &&
    input.shellSelectedProfile?.openMeldProfileId === profileId
  ) {
    profileName = input.shellSelectedProfile.profileName;
  }

  return {
    installed: true,
    effectiveRuntimeStatus: runtimeContext.effectiveRuntimeStatus,
    profileId,
    profileName,
    serviceController:
      runtimeContext.runtimeStatus.serviceController === "unknown"
        ? null
        : runtimeContext.runtimeStatus.serviceController,
    serviceFreshnessWarning,
    autoStart: runtimeContext.runtimeStatus.autoStart,
  };
}

function toWhoamiServiceFreshnessWarning(
  warning: DaemonServiceFreshnessWarning | null
): WhoamiServiceFreshnessWarning | null {
  if (!warning) {
    return null;
  }
  return {
    anomalyCodes: warning.anomalyCodes,
    code: warning.code,
    detailText: warning.detailText,
    nextSteps: warning.nextSteps,
    summaryText: warning.summaryText,
  };
}

async function resolveWhoamiShellProfileContext(input: {
  activeCommandProfile: OpenMeldProfile | null;
  authState: AuthSessionState;
  resolvedView: "human" | "agent";
}): Promise<WhoamiShellProfileContext> {
  if (input.authState !== "valid") {
    return {
      profileId: null,
      profile: null,
      lookupFailure: null,
    };
  }

  let selectedProfileId: string | null = null;
  try {
    selectedProfileId = await getSelectedOpenMeldProfileId();
  } catch (error) {
    return {
      profileId: null,
      profile: null,
      lookupFailure: resolveSelectedShellProfileLookupFailureGuidance({
        error,
        resolvedView: input.resolvedView,
      }),
    };
  }

  if (!selectedProfileId) {
    return {
      profileId: null,
      profile: null,
      lookupFailure: null,
    };
  }

  if (input.activeCommandProfile?.openMeldProfileId === selectedProfileId) {
    return {
      profileId: selectedProfileId,
      profile: input.activeCommandProfile,
      lookupFailure: null,
    };
  }

  let selectedProfileLookupError: unknown = null;
  const selectedProfile = await resolveOpenMeldProfileOrNull({
    openMeldProfileId: selectedProfileId,
    allowUnauthenticated: false,
    allowDefaultFallback: false,
    persistSelection: false,
  }).catch((error: unknown) => {
    selectedProfileLookupError = error;
    return null;
  });

  return {
    profileId: selectedProfileId,
    profile: selectedProfile,
    lookupFailure: selectedProfileLookupError
      ? resolveSelectedShellProfileLookupFailureGuidance({
          error: selectedProfileLookupError,
          resolvedView: input.resolvedView,
        })
      : null,
  };
}

async function resolveProfileMissingGuidance(input: {
  authState: AuthSessionState;
  resolvedView: "human" | "agent";
}): Promise<ProfileMissingGuidance> {
  if (input.authState !== "valid") {
    return {
      hint: resolveAuthenticationGuidance({
        reason: "required",
      }).errorNextStep,
      nextSteps: formatOpenMeldCliCommands(["openmeld login"]),
      profilesFound: false,
      eligibleProfileCount: 0,
    };
  }

  const viewArg =
    input.resolvedView === "agent" ? " --view agent" : " --view human";
  const listCommand = formatOpenMeldCliCommand(
    `openmeld profiles list${viewArg}`
  );
  const setCommand = formatOpenMeldCliCommand(
    `openmeld profiles set <profile-id>${viewArg}`
  );
  const whoamiCommand = formatOpenMeldCliCommand(
    `openmeld whoami --profile <profile-id>${viewArg}`
  );
  const recoveryCommand =
    input.resolvedView === "agent"
      ? formatOpenMeldCliCommand(
          "openmeld profiles create <profile-name> --kind agent --view agent"
        )
      : formatOpenMeldCliCommand("openmeld start --view human");

  let profiles: OpenMeldProfile[];
  try {
    profiles = await listOpenMeldProfiles();
  } catch {
    return {
      hint: `run \`${listCommand}\`, then rerun with \`${whoamiCommand}\``,
      nextSteps: [listCommand, whoamiCommand],
      profilesFound: false,
      eligibleProfileCount: 0,
    };
  }

  const allProfiles = Array.isArray(profiles) ? profiles : [];
  const visibleProfiles =
    input.resolvedView === "agent"
      ? allProfiles.filter((profile) => profile.profileKind === "agent")
      : allProfiles;
  if (visibleProfiles.length === 0) {
    return {
      hint: `run \`${recoveryCommand}\``,
      nextSteps: [recoveryCommand, listCommand, whoamiCommand],
      profilesFound: false,
      eligibleProfileCount: 0,
    };
  }

  return {
    hint: `run \`${setCommand}\` or rerun with \`${whoamiCommand}\``,
    nextSteps: [listCommand, setCommand, whoamiCommand],
    profilesFound: true,
    eligibleProfileCount: visibleProfiles.length,
  };
}

async function resolveWhoamiProfileResolutionGuidance(input: {
  openMeldProfile: OpenMeldProfile | null;
  authState: AuthSessionState;
  openMeldProfileLookupError: unknown;
  resolvedView: "human" | "agent";
}): Promise<{
  missing: ProfileMissingGuidance | null;
  lookupFailure: ProfileLookupFailureGuidance | null;
}> {
  if (input.openMeldProfile) {
    return {
      missing: null,
      lookupFailure: null,
    };
  }

  if (input.openMeldProfileLookupError) {
    return {
      missing: null,
      lookupFailure: resolveProfileLookupFailureGuidance({
        resolvedView: input.resolvedView,
        error: input.openMeldProfileLookupError,
      }),
    };
  }

  return {
    missing: await resolveProfileMissingGuidance({
      authState: input.authState,
      resolvedView: input.resolvedView,
    }),
    lookupFailure: null,
  };
}

function resolveProfileLookupFailureGuidance(input: {
  resolvedView: "human" | "agent";
  error: unknown;
}): ProfileLookupFailureGuidance {
  const viewArg =
    input.resolvedView === "agent" ? " --view agent" : " --view human";
  return {
    summary: "OpenMeld could not load the selected profile right now.",
    details: toProfileLookupErrorMessage(input.error),
    nextSteps: [
      formatOpenMeldCliCommand(`openmeld auth status${viewArg}`),
      formatOpenMeldCliCommand(`openmeld profiles list${viewArg}`),
    ],
  };
}

function resolveSelectedShellProfileLookupFailureGuidance(input: {
  resolvedView: "human" | "agent";
  error: unknown;
}): ProfileLookupFailureGuidance {
  const viewArg =
    input.resolvedView === "agent" ? " --view agent" : " --view human";
  return {
    summary: "OpenMeld could not load the selected shell profile right now.",
    details: toProfileLookupErrorMessage(input.error),
    nextSteps: [
      formatOpenMeldCliCommand(`openmeld profiles list${viewArg}`),
      formatOpenMeldCliCommand(`openmeld service status${viewArg}`),
    ],
  };
}

function buildShellSelectedProfileRows(input: {
  activeCommandProfile: OpenMeldProfile;
  activeProfileSource: "explicit" | "selected";
  shellProfileContext: WhoamiShellProfileContext;
}): InfoCardRow[] {
  const shellProfile = input.shellProfileContext.profile;
  const shellProfileId = input.shellProfileContext.profileId;
  const shellLookupFailure = input.shellProfileContext.lookupFailure;
  const shouldRenderShellProfileRow =
    input.activeProfileSource === "explicit" ||
    shellLookupFailure !== null ||
    shellProfileId === null ||
    shellProfile?.openMeldProfileId !==
      input.activeCommandProfile.openMeldProfileId;

  if (!shouldRenderShellProfileRow) {
    return [];
  }

  if (shellLookupFailure) {
    return [
      {
        label: "Selected Shell Profile",
        value: pc.bold(pc.yellow("temporarily unavailable")),
      },
    ];
  }

  if (!shellProfileId) {
    return [
      {
        label: "Selected Shell Profile",
        value: pc.bold(pc.yellow("not selected yet")),
      },
    ];
  }

  if (!shellProfile) {
    return [
      {
        label: "Selected Shell Profile",
        value: shellProfileId,
      },
    ];
  }

  return [
    {
      label: "Selected Shell Profile",
      value: formatHighlightedProfileName({
        profileKind: shellProfile.profileKind,
        profileName: shellProfile.profileName,
      }),
    },
  ];
}

function resolveWhoamiProfileAlignment(input: {
  activeCommandProfile: OpenMeldProfile | null;
  daemonServiceContext: WhoamiDaemonServiceContext;
  resolvedView: "human" | "agent";
  shellProfileContext: WhoamiShellProfileContext;
}): WhoamiProfileAlignment {
  const viewArg =
    input.resolvedView === "agent" ? " --view agent" : " --view human";
  const shellSelectedProfileId = input.shellProfileContext.profileId;
  const serviceProfileId = input.daemonServiceContext.profileId;
  const whyItMatters =
    "Commands without --profile use the shell default. Background replies use the OpenMeld Service default. This is OK when you intentionally inspect a specific profile.";

  if (input.shellProfileContext.lookupFailure) {
    return {
      status: "shell_profile_unavailable",
      summary: "OpenMeld could not load the selected shell profile right now",
      whyItMatters,
      nextSteps: input.shellProfileContext.lookupFailure.nextSteps,
      shellSelectedProfileId,
      serviceProfileId,
    };
  }

  if (!(shellSelectedProfileId || serviceProfileId)) {
    return {
      status: "no_saved_profiles",
      summary: "No saved shell or OpenMeld Service profile is set yet",
      whyItMatters,
      nextSteps: input.activeCommandProfile
        ? [
            formatOpenMeldCliCommand(
              `openmeld profiles set ${input.activeCommandProfile.openMeldProfileId}${viewArg}`
            ),
            formatOpenMeldCliCommand(`openmeld service status${viewArg}`),
          ]
        : [],
      shellSelectedProfileId,
      serviceProfileId,
    };
  }

  if (!serviceProfileId) {
    return {
      status: "service_profile_not_set",
      summary:
        "This shell has a selected profile, but OpenMeld Service does not",
      whyItMatters,
      nextSteps: [
        formatOpenMeldCliCommand(`openmeld service status${viewArg}`),
      ],
      shellSelectedProfileId,
      serviceProfileId,
    };
  }

  if (!shellSelectedProfileId) {
    return {
      status: "shell_profile_not_selected",
      summary: "OpenMeld Service has a saved profile, but this shell does not",
      whyItMatters,
      nextSteps: [
        formatOpenMeldCliCommand(
          `openmeld profiles set ${serviceProfileId}${viewArg}`
        ),
        formatOpenMeldCliCommand(`openmeld service status${viewArg}`),
      ],
      shellSelectedProfileId,
      serviceProfileId,
    };
  }

  if (shellSelectedProfileId === serviceProfileId) {
    return {
      status: "aligned",
      summary: "This shell and OpenMeld Service are using the same profile",
      whyItMatters: null,
      nextSteps: [],
      shellSelectedProfileId,
      serviceProfileId,
    };
  }

  return {
    status: "drifted",
    summary: "Shell default and OpenMeld Service default are different",
    whyItMatters,
    nextSteps: [
      formatOpenMeldCliCommand(`openmeld service status${viewArg}`),
      formatOpenMeldCliCommand(
        `openmeld profiles set ${serviceProfileId}${viewArg}`
      ),
    ],
    shellSelectedProfileId,
    serviceProfileId,
  };
}

function formatProfileAlignmentSummary(input: WhoamiProfileAlignment): string {
  return input.status === "aligned"
    ? pc.bold(pc.green(input.summary))
    : pc.bold(pc.yellow(input.summary));
}

function resolveWhoamiAgentProfileStateRows(
  profile: OpenMeldProfile
): Array<{ label: string; value: string }> {
  return buildAgentProfileStateRows(profile);
}
