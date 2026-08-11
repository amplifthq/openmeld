import { buildLocalServiceDiagnosticsPayload } from "@openmeld/local-service";
import type {
  CliJsonOutputEnvelope,
  CliVersionVerdict,
  DaemonStatusServerRequirement,
  ServiceVersionVerdict,
} from "@openmeld/schemas";
import { listAgentTargetStates } from "../agents/registry";
import type { CliUpdateAssessment } from "../command-entry-checks/cli-update-assessment";
import {
  describeServerRequiredVersionUnavailableReason,
  type ServerRequiredVersionAssessment,
} from "../command-entry-checks/server-required-version-assessment";
import {
  reconcileCliVersionView,
  reconcileServiceVersionView,
} from "../command-entry-checks/version-reconciliation";
import type {
  DaemonServiceRuntimeStatus,
  getDaemonStatus,
} from "../config/daemon-state";
import type { resolveOpenMeldEnvironmentTarget } from "../config/openmeld-environment-target";
import {
  type OpenMeldLaneDescriptor,
  resolveOpenMeldLaneDescriptor,
} from "../config/openmeld-lane-descriptor";
import { formatDaemonLifecycleOriginSummary } from "../local-service/lifecycle/daemon-lifecycle-journal";
import { DAEMON_SERVICE_REPAIR_ANOMALIES } from "../local-service/lifecycle/daemon-service-anomaly-groups";
import { buildDaemonServiceCleanupPlan } from "../local-service/lifecycle/daemon-service-hygiene";
import type { inspectDaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import type { DaemonServiceManagerRuntimeStatus } from "../local-service/lifecycle/daemon-service-manager";
import {
  buildDaemonOwnerSnapshotFromObservedState,
  formatDaemonOwnerSummaryLabel,
} from "../local-service/lifecycle/daemon-service-owner-snapshot";
import {
  buildDaemonServiceRefreshNextStep,
  buildDaemonServiceStatusReadOnlyDetail,
} from "../local-service/lifecycle/daemon-service-repair-guidance";
import { getEffectiveDaemonRuntimeStatus } from "../local-service/lifecycle/daemon-service-runtime";
import {
  NO_LOCAL_AGENTS_NEED_OPENMELD_SERVICE_REASON,
  type syncDeviceRuntimeStateProjection,
} from "../local-service/reporting/device-runtime-state-sync";
import type { readDaemonRuntimeContractRepairReport } from "../local-service/state/runtime-contract-guard";
import type { DaemonLocalStatusSnapshot } from "../local-service/status/daemon-local-status-snapshot";
import type { DaemonStatusAttention } from "../local-service/status/daemon-status-attention";
import type { DaemonStatusSnapshot } from "../local-service/status/daemon-status-snapshot";
import { buildProfileWorkspacePresentation } from "../profile-workspace/presentation";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
  formatOpenMeldCliTextBlock,
} from "../runtime/cli-entry-command";
import type { RuntimeContext } from "../runtime/context";
import { isBinaryDistribution } from "../runtime/distribution";
import type { createPresenter } from "../runtime/presenter/index";
import type { DaemonRouteObservation } from "../system/current-reply-readiness-snapshot";
import { formatDaemonServiceMissingAction } from "../system/local-service-install-attention";
import type { DeviceReplyReadinessStatus } from "../system/reply-readiness";
import {
  formatServiceRuntimeHeadline,
  resolveServiceParticipationReadiness,
  type ServiceParticipationReadinessSummary,
} from "../system/service-participation-readiness";
import { renderInfoCard } from "../ui/info-card";
import {
  formatDaemonDisplayRows,
  renderServiceActionCard,
} from "./service-output";

export const STATUS_CLEANUP_SIGNIFICANT_ANOMALIES =
  DAEMON_SERVICE_REPAIR_ANOMALIES;

export const AGENT_READINESS_DETAIL_PATTERN =
  /\b(agents?|profiles?|workspaces?|controllers?)\b|reply route|reply from space|space replies/i;

// Installed OpenMeld Service (daemon) version, read off the same
// `daemonStatus` shape the human status card already renders
// ("🏷️ Version" in `renderDaemonStatusCard`). Duck-typed on purpose so this
// helper does not need its own import of the `DaemonStatus` type.
function resolveInstalledServiceVersionForStatus(daemonStatus: {
  installed: boolean;
  state: { daemonVersion: string } | null;
}): string | null {
  return daemonStatus.installed && daemonStatus.state
    ? daemonStatus.state.daemonVersion
    : null;
}

/**
 * Builds the additive `serverRequirement` block: the server-required version
 * visor (Core's compiled release manifest, read live via
 * `getCurrentLocalRuntimeReplyReadiness`) plus the one-line verdict
 * reconciling it against the release-channel view already carried in
 * `cliVersion`. This is new, nullable, and does not rename or remove any
 * existing `--json` field (`developing/clients/web.md` /
 * W-REL-DOCTOR: two channels, shown side by side, merged verdict when they
 * disagree).
 */
export function buildServerRequirementJsonPayload(input: {
  channel: CliUpdateAssessment;
  server: ServerRequiredVersionAssessment;
  installedServiceVersion: string | null;
}): DaemonStatusServerRequirement {
  if (!input.server.available) {
    return {
      available: false,
      reason: input.server.reason,
      detail: input.server.detail,
    };
  }

  return {
    available: true,
    generatedAt: input.server.generatedAt,
    cli: input.server.cli,
    service: input.server.service,
    verdict: {
      cli: reconcileCliVersionView({
        channel: input.channel,
        server: input.server,
      }),
      service: reconcileServiceVersionView({
        installedVersion: input.installedServiceVersion,
        server: input.server,
      }),
    },
  };
}

export function buildDaemonStatusJsonPayload(input: {
  cliVersion: {
    checked: boolean;
    currentVersion: string;
    latestVersion: string | null;
    requiredVersion: string | null;
    updateAvailable: boolean;
  };
  environmentTarget: Awaited<
    ReturnType<typeof resolveOpenMeldEnvironmentTarget>
  >;
  localSnapshot: DaemonLocalStatusSnapshot;
  serverRequirementChannelAssessment: CliUpdateAssessment;
  serverRequirementAssessment: ServerRequiredVersionAssessment;
  snapshot: DaemonStatusSnapshot;
}): CliJsonOutputEnvelope {
  return {
    schemaVersion: 1,
    type: "daemon.status",
    runtimeFlavor: isBinaryDistribution() ? "binary" : "node-bundle",
    cliVersion: input.cliVersion,
    localResult: buildDaemonAgentLocalStatusPayload({
      environmentTarget: input.environmentTarget,
      snapshot: input.localSnapshot,
    }),
    result: buildDaemonAgentStatusPayload({
      environmentTarget: input.environmentTarget,
      snapshot: input.snapshot,
    }),
    runtimeProjection:
      input.snapshot.currentReplyReadiness.runtimeProjection ?? null,
    serverRequirement: buildServerRequirementJsonPayload({
      channel: input.serverRequirementChannelAssessment,
      installedServiceVersion: resolveInstalledServiceVersionForStatus(
        input.snapshot.currentReplyReadiness.daemonStatus
      ),
      server: input.serverRequirementAssessment,
    }),
  };
}

/**
 * Human-readable dual-channel version card for `openmeld service status`:
 * the release-channel view (unchanged) shown next to the server-required
 * view (new), plus the one-line merged verdict for each component. Rendered
 * as its own card, appended after the main status card, so it never disturbs
 * existing row-order assertions on the primary status card.
 */
export function renderVersionReconciliationCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  channel: CliUpdateAssessment;
  server: ServerRequiredVersionAssessment;
  installedServiceVersion: string | null;
}): void {
  const cliVerdict = reconcileCliVersionView({
    channel: input.channel,
    server: input.server,
  });
  const serviceVerdict = reconcileServiceVersionView({
    installedVersion: input.installedServiceVersion,
    server: input.server,
  });

  const rows = [
    { label: "🖥️ CLI Current", value: input.channel.currentVersion },
    {
      label: "📡 CLI Channel Latest",
      value: input.channel.checked
        ? (input.channel.latestVersion ?? "unavailable")
        : "not checked in this environment",
    },
    ...(input.channel.requiredFloor
      ? [{ label: "🚧 CLI Channel Floor", value: input.channel.requiredFloor }]
      : []),
    {
      label: "🛰️ CLI Server Required",
      value: formatServerCliVisorCell(input.server),
    },
    { label: "🧭 CLI Verdict", value: formatVersionVerdictCell(cliVerdict) },
    { label: "", value: "" },
    {
      label: "🧩 Service Installed",
      value: input.installedServiceVersion ?? "unknown",
    },
    {
      label: "🛰️ Service Server Required",
      value: formatServerServiceVisorCell(input.server),
    },
    {
      label: "🧭 Service Verdict",
      value: formatVersionVerdictCell(serviceVerdict),
    },
  ];

  renderInfoCard({
    presenter: input.presenter,
    title: "🏷️ OpenMeld Version Check",
    codePrefix: "daemon.status.version_check",
    sanitize: true,
    rows: formatDaemonDisplayRows(rows),
  });
}

function formatServerCliVisorCell(
  server: ServerRequiredVersionAssessment
): string {
  if (!server.available) {
    return `unavailable (${describeServerRequiredVersionUnavailableReason(server)})`;
  }
  return `${server.cli.latestPackageVersion ?? "unknown"} (status: ${server.cli.status})`;
}

function formatServerServiceVisorCell(
  server: ServerRequiredVersionAssessment
): string {
  if (!server.available) {
    return `unavailable (${describeServerRequiredVersionUnavailableReason(server)})`;
  }
  const version =
    server.service.requiredVersion ?? server.service.latestVersion ?? "unknown";
  return `${version} (status: ${server.service.status})`;
}

function formatVersionVerdictCell(
  verdict: CliVersionVerdict | ServiceVersionVerdict
): string {
  return `${resolveVersionVerdictIcon(verdict.kind)} ${verdict.message}`;
}

function resolveVersionVerdictIcon(
  kind: CliVersionVerdict["kind"] | ServiceVersionVerdict["kind"]
): string {
  if (kind === "aligned") {
    return "✅";
  }
  if (
    kind === "channel_behind" ||
    kind === "channel_ahead" ||
    kind === "update_required"
  ) {
    return "⚠️";
  }
  return "ℹ️";
}

export function buildDaemonAgentStatusPayload(input: {
  environmentTarget: Awaited<
    ReturnType<typeof resolveOpenMeldEnvironmentTarget>
  >;
  snapshot: DaemonStatusSnapshot;
}) {
  const { environmentTarget, snapshot } = input;
  const currentProfileWorkspace = buildProfileWorkspacePresentation(
    snapshot.currentReplyReadiness.profileWorkspaceRuntimeResolution
  );
  return {
    ...snapshot.currentReplyReadiness.daemonStatus,
    environmentTarget,
    ...(snapshot.currentReplyReadiness.runtimeStatus
      ? { runtime: snapshot.currentReplyReadiness.runtimeStatus }
      : {}),
    ...(snapshot.runtimeContractRepairReport
      ? { runtimeContractRepair: snapshot.runtimeContractRepairReport }
      : {}),
    ...(snapshot.currentReplyReadiness.inventory
      ? {
          inventory: {
            anomalies: snapshot.currentReplyReadiness.inventory.anomalies,
            ...(snapshot.currentReplyReadiness.inventory
              .runtimeContractCompatibility
              ? {
                  runtimeContractCompatibility:
                    snapshot.currentReplyReadiness.inventory
                      .runtimeContractCompatibility,
                }
              : {}),
            cleanupPlan: buildDaemonServiceCleanupPlan({
              intent: "status_cleanup",
              inventory: snapshot.currentReplyReadiness.inventory,
            }),
          },
        }
      : {}),
    daemonRouteObservation:
      snapshot.currentReplyReadiness.daemonRouteObservation,
    diagnostics: buildDaemonLocalReplyReadinessEvidenceDiagnostics({
      deviceReplyReadiness: snapshot.currentReplyReadiness.deviceReplyReadiness,
      legacyAgentReplyReadiness:
        snapshot.currentReplyReadiness.agentReplyReadiness,
    }),
    currentProfileWorkspace,
    ...(snapshot.attention ? { attention: snapshot.attention } : {}),
    ...(snapshot.latestConnectionStateEvent
      ? { latestConnectionStateEvent: snapshot.latestConnectionStateEvent }
      : {}),
    ...(snapshot.latestLifecycleEvent
      ? { latestLifecycleEvent: snapshot.latestLifecycleEvent }
      : {}),
  };
}

export function emitDaemonAgentStatus(input: {
  environmentTarget: Awaited<
    ReturnType<typeof resolveOpenMeldEnvironmentTarget>
  >;
  presenter: ReturnType<typeof createPresenter>;
  snapshot: DaemonStatusSnapshot;
}): void {
  const { environmentTarget, presenter, snapshot } = input;
  presenter.data({
    code: "daemon.status.result",
    payload: buildDaemonAgentStatusPayload({
      environmentTarget,
      snapshot,
    }),
  });
  if (!snapshot.currentReplyReadiness.runtimeProjection) {
    return;
  }
  presenter.data({
    code: "daemon.runtime_projection.result",
    payload: snapshot.currentReplyReadiness.runtimeProjection,
  });
}

export function buildDaemonLocalReplyReadinessEvidenceDiagnostics(input: {
  deviceReplyReadiness: unknown;
  legacyAgentReplyReadiness: unknown;
}) {
  return buildLocalServiceDiagnosticsPayload({
    deviceEvidence: input.deviceReplyReadiness,
    agentEvidence: input.legacyAgentReplyReadiness,
  });
}

export function buildDaemonAgentLocalStatusPayload(input: {
  environmentTarget: Awaited<
    ReturnType<typeof resolveOpenMeldEnvironmentTarget>
  >;
  snapshot: DaemonLocalStatusSnapshot;
}) {
  const { environmentTarget, snapshot } = input;
  return {
    ...snapshot.daemonStatus,
    environmentTarget,
    statusScope: "local_service",
    ...(snapshot.runtimeStatus ? { runtime: snapshot.runtimeStatus } : {}),
    ...(snapshot.serviceManagerStatus
      ? { serviceManagerStatus: snapshot.serviceManagerStatus }
      : {}),
    ...(snapshot.runtimeContractRepairReport
      ? { runtimeContractRepair: snapshot.runtimeContractRepairReport }
      : {}),
    ...(snapshot.inventory
      ? {
          inventory: {
            anomalies: snapshot.inventory.anomalies,
            ...(snapshot.inventory.runtimeContractCompatibility
              ? {
                  runtimeContractCompatibility:
                    snapshot.inventory.runtimeContractCompatibility,
                }
              : {}),
            cleanupPlan: buildDaemonServiceCleanupPlan({
              intent: "status_cleanup",
              inventory: snapshot.inventory,
            }),
          },
        }
      : {}),
    ...(snapshot.attention ? { attention: snapshot.attention } : {}),
    ...(snapshot.latestConnectionStateEvent
      ? { latestConnectionStateEvent: snapshot.latestConnectionStateEvent }
      : {}),
    ...(snapshot.latestLifecycleEvent
      ? { latestLifecycleEvent: snapshot.latestLifecycleEvent }
      : {}),
  };
}

export function emitDaemonAgentLocalStatus(input: {
  environmentTarget: Awaited<
    ReturnType<typeof resolveOpenMeldEnvironmentTarget>
  >;
  presenter: ReturnType<typeof createPresenter>;
  snapshot: DaemonLocalStatusSnapshot;
}): void {
  const { environmentTarget, presenter, snapshot } = input;
  presenter.data({
    code: "daemon.status.local_result",
    payload: buildDaemonAgentLocalStatusPayload({
      environmentTarget,
      snapshot,
    }),
  });
}

export async function emitDaemonStatusForView(input: {
  presenter: ReturnType<typeof createPresenter>;
  snapshot: DaemonStatusSnapshot;
  view: RuntimeContext["resolvedView"];
}): Promise<void> {
  if (!input.snapshot.currentReplyReadiness.daemonStatus.installed) {
    emitDaemonNotInstalledStatus({
      attention: input.snapshot.attention,
      daemonRouteObservation:
        input.snapshot.currentReplyReadiness.daemonRouteObservation,
      presenter: input.presenter,
      view: input.view,
    });
    return;
  }

  if (input.view === "human") {
    renderDaemonStatusCard({
      attention: input.snapshot.attention,
      daemonRouteObservation:
        input.snapshot.currentReplyReadiness.daemonRouteObservation,
      deviceReplyReadiness:
        input.snapshot.currentReplyReadiness.deviceReplyReadiness,
      inventory: input.snapshot.currentReplyReadiness.inventory,
      presenter: input.presenter,
      status: input.snapshot.currentReplyReadiness.daemonStatus,
      runtimeState:
        input.snapshot.currentReplyReadiness.displayRuntimeStatus ??
        input.snapshot.currentReplyReadiness.runtimeStatus,
      serviceManagerStatus:
        input.snapshot.currentReplyReadiness.serviceManagerStatus,
      latestLifecycleEvent: input.snapshot.latestLifecycleEvent,
      runtimeContractRepairReport: input.snapshot.runtimeContractRepairReport,
    });
    if (input.snapshot.currentReplyReadiness.inventory) {
      renderDaemonStatusCleanupRecommendation({
        attention: input.snapshot.attention,
        presenter: input.presenter,
        inventory: input.snapshot.currentReplyReadiness.inventory,
      });
    }
    return;
  }

  await emitDaemonInstalledTextStatus({
    presenter: input.presenter,
    runtimeProjection: input.snapshot.currentReplyReadiness.runtimeProjection,
    runtimeState: input.snapshot.currentReplyReadiness.runtimeStatus,
    status: input.snapshot.currentReplyReadiness.daemonStatus,
  });
}

export function emitDaemonNotInstalledStatus(input: {
  attention: DaemonStatusAttention | null;
  daemonRouteObservation: DaemonRouteObservation;
  presenter: ReturnType<typeof createPresenter>;
  view: RuntimeContext["resolvedView"];
}): void {
  if (input.view === "human") {
    renderDaemonNotInstalledCard({
      attention: input.attention,
      daemonRouteObservation: input.daemonRouteObservation,
      presenter: input.presenter,
    });
    return;
  }

  input.presenter.line({
    code: "daemon.status.not_installed",
    text: "OpenMeld Service is not installed.",
  });
}

export async function emitDaemonInstalledTextStatus(input: {
  presenter: ReturnType<typeof createPresenter>;
  runtimeProjection: Awaited<
    ReturnType<typeof syncDeviceRuntimeStateProjection>
  > | null;
  runtimeState: DaemonServiceRuntimeStatus | null;
  status: Awaited<ReturnType<typeof getDaemonStatus>>;
}): Promise<void> {
  const daemonVersion = input.status.state?.daemonVersion ?? "unknown";
  input.presenter.line({
    code: "daemon.status.installed",
    text: `OpenMeld Service is installed (version ${daemonVersion}).`,
  });
  input.presenter.line({
    code: "daemon.status.runtime",
    text: describeDaemonRuntimeStatus(input.runtimeState),
  });
  await emitRuntimeProjectionLine({
    presenter: input.presenter,
    runtimeProjection: input.runtimeProjection,
  });
}

export function formatDaemonStatusNotInstalledHint(): string {
  return formatDaemonServiceMissingAction();
}

export function renderDaemonNotInstalledCard(input: {
  attention: DaemonStatusAttention | null;
  daemonRouteObservation: DaemonRouteObservation;
  presenter: ReturnType<typeof createPresenter>;
}): void {
  const rows = formatDaemonDisplayRows([
    {
      label: "🧩 OpenMeld Service",
      value:
        "⛔ Not installed — install OpenMeld Service so this computer can receive local Wake work",
    },
    {
      label: "⚙️ Runtime",
      value: "⚪ Unknown",
    },
    {
      label: "🌐 OpenMeld Connection",
      value: formatDaemonStatusConnectionLabel(input.daemonRouteObservation),
    },
    ...buildDaemonLaneScopeRows(),
    {
      label: "ℹ️ Status",
      value: buildDaemonServiceStatusReadOnlyDetail(),
    },
    ...(input.attention
      ? [
          { label: "", value: "" },
          {
            label:
              input.attention.level === "warning"
                ? "⚠️ Attention"
                : "ℹ️ Attention",
            value: input.attention.message,
          },
          ...(input.attention.nextStep
            ? [{ label: "🔧 Next", value: input.attention.nextStep }]
            : []),
          {
            label: "🚀 After That",
            value: formatDaemonStatusNotInstalledHint(),
          },
        ]
      : [{ label: "🔧 Next", value: formatDaemonStatusNotInstalledHint() }]),
  ]);

  renderInfoCard({
    presenter: input.presenter,
    title: "🧩 OpenMeld Service",
    codePrefix: "daemon.status.card",
    sanitize: true,
    rows,
  });
}

export function renderDaemonStatusCard(input: {
  attention: DaemonStatusAttention | null;
  daemonRouteObservation: DaemonRouteObservation;
  deviceReplyReadiness: DeviceReplyReadinessStatus;
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>> | null;
  presenter: ReturnType<typeof createPresenter>;
  status: {
    installed: true;
    state: {
      daemonVersion: string;
    };
  };
  latestLifecycleEvent: DaemonStatusSnapshot["latestLifecycleEvent"];
  runtimeState: DaemonServiceRuntimeStatus | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  runtimeContractRepairReport: Awaited<
    ReturnType<typeof readDaemonRuntimeContractRepairReport>
  > | null;
}): void {
  const effectiveRuntimeState = input.runtimeState
    ? {
        ...input.runtimeState,
        status: resolveDaemonStatusEffectiveRuntimeStatus({
          inventory: input.inventory,
          runtimeState: input.runtimeState,
          serviceManagerStatus: input.serviceManagerStatus,
        }),
      }
    : null;
  const serviceParticipationReadiness = resolveServiceParticipationReadiness({
    deviceReplyReadiness: input.deviceReplyReadiness,
    inventory: input.inventory,
    runtimeStatus: effectiveRuntimeState,
  });
  const statusSummaryRows = buildDaemonStatusSummaryRows({
    daemonRouteObservation: input.daemonRouteObservation,
    serviceParticipationReadiness,
    inventory: input.inventory,
    runtimeState: effectiveRuntimeState ?? input.runtimeState,
  });
  const nextStep =
    input.attention?.nextStep ??
    resolveDaemonStatusNextStep({
      serviceParticipationReadiness,
    });
  const rows: Array<{ label: string; value: string }> = [
    ...statusSummaryRows,
    {
      label: "ℹ️ Status",
      value: buildDaemonServiceStatusReadOnlyDetail(),
    },
    ...buildDaemonStatusAttentionRows({
      attention: input.attention,
      latestLifecycleEvent: input.latestLifecycleEvent,
      nextStep,
    }),
    { label: "", value: "" },
    { label: "📦 Installed", value: "yes" },
    { label: "🏷️ Version", value: input.status.state.daemonVersion },
    ...buildRuntimeDetailRows({
      runtimeState: input.runtimeState,
      serviceManagerStatus: input.serviceManagerStatus,
    }),
    ...buildRuntimeContractRepairRows(input.runtimeContractRepairReport),
  ];

  renderInfoCard({
    presenter: input.presenter,
    title: "🧩 OpenMeld Service Status",
    codePrefix: "daemon.status.card",
    sanitize: true,
    rows: formatDaemonDisplayRows(rows),
  });
}

export function buildDaemonStatusAttentionRows(input: {
  attention: DaemonStatusAttention | null;
  latestLifecycleEvent: DaemonStatusSnapshot["latestLifecycleEvent"];
  nextStep: string | null;
}): Array<{ label: string; value: string }> {
  const lifecycleRow = input.latestLifecycleEvent
    ? [
        {
          label: "🧾 Last Service Change",
          value: formatDaemonLifecycleOriginSummary(input.latestLifecycleEvent),
        },
      ]
    : [];
  if (input.attention) {
    return [
      { label: "", value: "" },
      {
        label:
          input.attention.level === "warning" ? "⚠️ Attention" : "ℹ️ Attention",
        value: input.attention.message,
      },
      ...(input.nextStep ? [{ label: "🔧 Next", value: input.nextStep }] : []),
      ...lifecycleRow,
    ];
  }

  if (!input.nextStep) {
    return lifecycleRow.length > 0
      ? [{ label: "", value: "" }, ...lifecycleRow]
      : [];
  }

  return [
    { label: "", value: "" },
    { label: "🔧 Next", value: input.nextStep },
    ...lifecycleRow,
  ];
}

export function resolveDaemonStatusNextStep(input: {
  serviceParticipationReadiness: ServiceParticipationReadinessSummary;
}): string | null {
  if (input.serviceParticipationReadiness.serviceReadiness === "not_running") {
    return `Run \`${formatOpenMeldCliCommand(
      "openmeld service start"
    )}\` to start OpenMeld Service.`;
  }

  if (
    input.serviceParticipationReadiness.serviceReadiness === "not_installed"
  ) {
    return `Run \`${formatOpenMeldCliCommand(
      "openmeld service install"
    )}\`, then \`${formatOpenMeldCliCommand(
      "openmeld service start"
    )}\` before using OpenMeld Service on this computer.`;
  }

  return input.serviceParticipationReadiness.nextStepSummary;
}

export function renderDaemonStatusCleanupRecommendation(input: {
  attention: DaemonStatusAttention | null;
  presenter: ReturnType<typeof createPresenter>;
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>>;
}): void {
  if (input.attention?.code !== "service_repair_recommended") {
    return;
  }
  const cleanupPlan = buildDaemonServiceCleanupPlan({
    intent: "status_cleanup",
    inventory: input.inventory,
  });
  if (cleanupPlan.actions.length === 0) {
    return;
  }
  const significantAnomalies = input.inventory.anomalies.filter((anomaly) =>
    STATUS_CLEANUP_SIGNIFICANT_ANOMALIES.has(anomaly.code)
  );
  if (significantAnomalies.length === 0) {
    return;
  }

  renderInfoCard({
    presenter: input.presenter,
    title: "🧹 OpenMeld Service Repair Recommended",
    codePrefix: "daemon.status.cleanup_recommended",
    rows: formatDaemonDisplayRows([
      {
        label: "📝 Found",
        value: input.attention.message,
      },
      {
        label: "💡 What OpenMeld can do",
        value:
          "OpenMeld will repair OpenMeld Service so this computer can connect for local Wake work reliably.",
      },
      {
        label: "🔧 Next",
        value: input.attention.nextStep ?? buildDaemonServiceRefreshNextStep(),
      },
    ]),
  });
}

export function buildDaemonStatusSummaryRows(input: {
  daemonRouteObservation: DaemonRouteObservation;
  serviceParticipationReadiness: ServiceParticipationReadinessSummary;
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>> | null;
  runtimeState: DaemonServiceRuntimeStatus | null;
}): Array<{ label: string; value: string }> {
  return [
    {
      label: "🧩 OpenMeld Service",
      value: formatDaemonStatusServiceReadinessLabel(
        input.serviceParticipationReadiness
      ),
    },
    {
      label: "⚙️ Runtime",
      value: formatServiceRuntimeHeadline(
        input.serviceParticipationReadiness.runtimeHeadline
      ),
    },
    {
      label: "🌐 OpenMeld Connection",
      value: formatDaemonStatusConnectionLabel(input.daemonRouteObservation, {
        runtimeState: input.runtimeState,
        serviceParticipationReadiness: input.serviceParticipationReadiness,
      }),
    },
    ...buildDaemonLaneScopeRows(),
    ...buildDaemonOwnerSummaryRows({
      inventory: input.inventory,
      runtimeState: input.runtimeState,
    }),
  ];
}

export function buildDaemonLaneScopeRows(
  lane: Pick<
    OpenMeldLaneDescriptor,
    "command" | "preset" | "openMeldHome"
  > = resolveOpenMeldLaneDescriptor()
): Array<{ label: string; value: string }> {
  return [
    {
      label: "🛤️ Current Lane",
      value: formatDaemonLaneLabel(lane),
    },
    {
      label: "📁 Local Data",
      value: lane.openMeldHome,
    },
  ];
}

function formatDaemonLaneLabel(
  lane: Pick<OpenMeldLaneDescriptor, "command" | "preset">
): string {
  switch (lane.preset) {
    case "dev-local":
      return `${lane.command} — repo-local development`;
    case "canary":
      return `${lane.command} — packaged candidate`;
    default:
      return `${lane.command} — published production`;
  }
}

export function formatDaemonStatusServiceReadinessLabel(
  input: ServiceParticipationReadinessSummary
): string {
  const detail = resolveDaemonStatusServiceDetail(input);
  switch (input.serviceReadiness) {
    case "ready":
      return `✅ ${input.summaryText} — ${detail}`;
    case "needs_repair":
      return `⚠️ ${input.summaryText} — ${detail}`;
    case "not_running":
    case "not_installed":
      return `⛔ ${input.summaryText} — ${detail}`;
    default:
      return `ℹ️ ${input.summaryText} — ${detail}`;
  }
}

export function resolveDaemonStatusServiceDetail(
  input: ServiceParticipationReadinessSummary
): string {
  const detail = input.detailText.trim();
  if (detail && !isAgentReadinessDetail(detail)) {
    return detail;
  }

  switch (input.serviceReadiness) {
    case "ready":
      return "OpenMeld Service is running on this device.";
    case "needs_repair":
      return "OpenMeld Service needs attention on this device.";
    case "not_installed":
      return "OpenMeld Service is not installed on this device.";
    case "not_running":
      return "OpenMeld Service is installed but not running on this device.";
    default:
      return "OpenMeld Service status is checking on this device.";
  }
}

export function isAgentReadinessDetail(detail: string): boolean {
  return AGENT_READINESS_DETAIL_PATTERN.test(detail);
}

export function formatDaemonStatusConnectionLabel(
  observation: DaemonRouteObservation,
  input: {
    runtimeState?: DaemonServiceRuntimeStatus | null;
    serviceParticipationReadiness?: ServiceParticipationReadinessSummary | null;
  } = {}
): string {
  if (
    input.serviceParticipationReadiness?.serviceReadiness === "needs_repair"
  ) {
    if (observation.status === "online") {
      return "🟡 Route online; local participation needs repair";
    }
    if (observation.status === "offline") {
      return "🔴 Route offline; local participation needs repair";
    }
    return "🟡 Route not checked; local participation needs repair";
  }
  if (
    input.serviceParticipationReadiness?.serviceReadiness === "not_running" ||
    input.serviceParticipationReadiness?.serviceReadiness === "not_installed"
  ) {
    return "🔴 Offline";
  }
  if (observation.status === "online") {
    return "🟢 Connected";
  }
  if (observation.status === "offline") {
    return "🔴 Offline";
  }
  if (isServiceLevelConnectionObservation(observation)) {
    if (input.serviceParticipationReadiness?.serviceReadiness === "ready") {
      return "🟢 Connected";
    }
    if (input.runtimeState?.status === "running") {
      return "🟢 Connected";
    }
  }
  return "⚪ Checking";
}

export function isServiceLevelConnectionObservation(
  observation: DaemonRouteObservation
): boolean {
  return (
    observation.status === "unavailable" &&
    (observation.reasonCode === "not_requested" ||
      observation.reasonCode === "profile_not_agent" ||
      observation.reasonCode === "profile_not_selected")
  );
}

export function buildDaemonOwnerSummaryRows(input: {
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>> | null;
  runtimeState: DaemonServiceRuntimeStatus | null;
}): Array<{ label: string; value: string }> {
  if (!input.inventory) {
    return [];
  }

  const effectiveRuntimeStatus =
    input.runtimeState?.status ?? input.inventory.runtimeStatus.status;
  const ownerSnapshot = buildDaemonOwnerSnapshotFromObservedState({
    runtimeStatus: input.inventory.runtimeStatus,
    serviceManager: input.inventory.serviceManager,
    serviceManagerStatus: input.inventory.serviceManagerStatus,
    effectiveRuntimeStatus,
    ownedProcesses: input.inventory.ownedProcesses,
  });

  return [
    {
      label: "🧭 Owner Path",
      value: formatDaemonOwnerSummaryLabel(ownerSnapshot),
    },
  ];
}

export function resolveDaemonStatusEffectiveRuntimeStatus(input: {
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>> | null;
  runtimeState: DaemonServiceRuntimeStatus;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
}): DaemonServiceRuntimeStatus["status"] {
  if (
    input.inventory?.anomalies.some(
      (anomaly) => anomaly.code === "manager_running_without_runtime"
    )
  ) {
    return input.runtimeState.status;
  }
  return getEffectiveDaemonRuntimeStatus({
    runtimeState: input.runtimeState,
    serviceManagerStatus: input.serviceManagerStatus,
  });
}

export function buildRuntimeContractRepairRows(
  runtimeContractRepairReport: Awaited<
    ReturnType<typeof readDaemonRuntimeContractRepairReport>
  > | null
): Array<{ label: string; value: string }> {
  if (!runtimeContractRepairReport) {
    return [];
  }

  if (runtimeContractRepairReport.status === "applied") {
    return [
      {
        label: "🩹 Automatic Repair",
        value: `✅ OpenMeld fixed a local service issue automatically at ${runtimeContractRepairReport.appliedAt}. No action needed.`,
      },
    ];
  }

  return [
    {
      label: "🩹 Automatic Repair",
      value: formatInlineOpenMeldCliCommands(
        `⚠️ OpenMeld could not finish repairing a local service issue at ${runtimeContractRepairReport.appliedAt}. Run \`openmeld service repair\`.`
      ),
    },
  ];
}

export function buildRuntimeDetailRows(input: {
  runtimeState: DaemonServiceRuntimeStatus | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
}): Array<{ label: string; value: string }> {
  if (input.runtimeState === null) {
    return [{ label: "⚙️ Runtime Details", value: "status unavailable" }];
  }

  const runtimeState = input.runtimeState;
  const effectiveStatus = getEffectiveDaemonRuntimeStatus({
    runtimeState,
    serviceManagerStatus: input.serviceManagerStatus,
  });
  return filterRuntimeSummaryRows([
    ...buildCoreRuntimeStateRows({
      runtimeState,
      effectiveStatus,
      serviceManagerStatus: input.serviceManagerStatus,
    }),
  ]);
}

// Plain-language run-mode label so status honestly tells the user a foreground
// service stops when the terminal closes, versus a persistent background one.
export function formatDaemonRunModeLabel(
  mode: DaemonServiceRuntimeStatus["mode"]
): string {
  if (mode === "foreground") {
    return "foreground — stops when the terminal closes";
  }
  if (mode === "background") {
    return "background service";
  }
  return "unknown";
}

export function buildCoreRuntimeStateRows(input: {
  runtimeState: DaemonServiceRuntimeStatus;
  effectiveStatus: DaemonServiceRuntimeStatus["status"];
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
}): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: "⚙️ Runtime", value: normalizeRuntimeState(input.effectiveStatus) },
  ];
  if (input.runtimeState.status === "running") {
    rows.push(
      {
        label: "🎚️ Mode",
        value: formatDaemonRunModeLabel(input.runtimeState.mode),
      },
      {
        label: "🧬 PID",
        value:
          input.runtimeState.pid === null
            ? "not available"
            : String(input.runtimeState.pid),
      },
      { label: "🚀 Started", value: input.runtimeState.startedAt ?? "unknown" },
      { label: "🕒 Updated", value: input.runtimeState.updatedAt ?? "unknown" }
    );
    return rows;
  }

  if (input.effectiveStatus === "running") {
    rows.push(
      {
        label: "🎚️ Mode",
        value: formatDaemonRunModeLabel(input.runtimeState.mode),
      },
      {
        label: "🧬 PID",
        value:
          input.runtimeState.pid === null
            ? "being managed by OS service manager"
            : String(input.runtimeState.pid),
      }
    );
    return rows;
  }

  if (input.runtimeState.status === "not_running") {
    rows.push({ label: "💤 Runtime", value: "not running" });
  }

  return rows;
}

export function filterRuntimeSummaryRows(
  rows: Array<{ label: string; value: string }>
): Array<{ label: string; value: string }> {
  const filteredRows = rows.filter(
    (row) => row.label !== "⚙️ Runtime" && row.label !== "💤 Runtime"
  );
  return filteredRows;
}

export function normalizeRuntimeState(
  status: DaemonServiceRuntimeStatus["status"]
): string {
  if (status === "running") {
    return "🟢 running";
  }
  if (status === "stale") {
    return "🟠 stale";
  }
  if (status === "not_running") {
    return "🔴 not running";
  }
  return "⚪ unknown";
}

export function formatDaemonSignInRequiredInstruction(): string {
  return `Run \`${formatOpenMeldCliCommand("openmeld login")}\` first.`;
}

export function formatDaemonInstallNextStep(
  runtimeProjection: Awaited<
    ReturnType<typeof syncDeviceRuntimeStateProjection>
  > | null
): string {
  if (requiresDaemonSignIn(runtimeProjection)) {
    return `Run \`${formatOpenMeldCliCommand("openmeld login")}\` first, then \`${formatOpenMeldCliCommand("openmeld service start")}\` to start OpenMeld Service in the background.`;
  }
  return formatInlineOpenMeldCliCommands(
    "Run `openmeld service start` now to keep OpenMeld Service running in the background."
  );
}

export function requiresDaemonSignIn(
  runtimeProjection: Awaited<
    ReturnType<typeof syncDeviceRuntimeStateProjection>
  > | null
): boolean {
  if (runtimeProjection?.status !== "skipped") {
    return false;
  }
  return isLocalControllerSignInRequiredReason(
    mapLocalControllerStatusReason(runtimeProjection.reason)
  );
}

export function isLocalControllerSignInRequiredReason(reason: string): boolean {
  return reason === "sign in required";
}

export async function emitRuntimeProjectionLine(input: {
  presenter: ReturnType<typeof createPresenter>;
  runtimeProjection: Awaited<
    ReturnType<typeof syncDeviceRuntimeStateProjection>
  > | null;
}): Promise<void> {
  if (!input.runtimeProjection) {
    return;
  }
  const projection = input.runtimeProjection;
  if (projection.status === "ok") {
    if (input.presenter.view === "human") {
      renderServiceActionCard({
        presenter: input.presenter,
        codePrefix: "daemon.runtime_projection.ok",
        title: "Local Service Link Connected",
        rows: [
          {
            label: "🧩 Status",
            value: "connected",
          },
          {
            label: "💡 Note",
            value:
              "This means OpenMeld finished the local service setup. Agent Profile Wake availability is checked separately.",
          },
        ],
      });
      return;
    }
    input.presenter.line({
      code: "daemon.runtime_projection.ok",
      text: "Local service setup is connected. Agent Profile Wake availability is checked separately.",
    });
    return;
  }
  if (projection.status === "degraded") {
    const repairSuggestion =
      projection.missingControllerIds.length > 0 ||
      (projection.repairRequiredControllerIds?.length ?? 0) > 0
        ? "`openmeld doctor --repair`"
        : "";
    const enableSuggestion = await resolveLocalEnableSuggestion({
      projectedControllerIds: projection.projectedControllerIds,
      disabledControllerIds: projection.disabledControllerIds,
    });
    const suggestionParts = [repairSuggestion]
      .concat(enableSuggestion ? [`\`${enableSuggestion}\``] : [])
      .filter((part) => part.length > 0);
    input.presenter.line({
      code: "daemon.runtime_projection.degraded",
      text: formatOpenMeldCliTextBlock(
        `Local agents on this device need a fix: ${mapLocalControllerStatusReason(
          projection.reason
        )}.${suggestionParts.length > 0 ? ` Run ${suggestionParts.join(" then ")}.` : ""}`
      ),
    });
    return;
  }
  if (
    isLocalControllerSignInRequiredReason(
      mapLocalControllerStatusReason(projection.reason)
    )
  ) {
    input.presenter.line({
      code: "daemon.runtime_projection.skipped",
      text: formatOpenMeldCliTextBlock(
        `Local agent setup is waiting for you to sign in. ${formatDaemonSignInRequiredInstruction()}`
      ),
    });
    return;
  }
  input.presenter.line({
    code: "daemon.runtime_projection.skipped",
    text: formatOpenMeldCliTextBlock(
      `Local agent setup was not checked: ${mapLocalControllerStatusReason(
        projection.reason
      )}.`
    ),
  });
}

export async function resolveLocalEnableSuggestion(input: {
  projectedControllerIds: string[];
  disabledControllerIds: string[];
}): Promise<string | null> {
  const states = await listAgentTargetStates().catch(() => []);
  const selectableBuiltinIds = new Set(
    states
      .filter(
        (state) =>
          state.targetKind === "builtin" &&
          state.lifecycleStatus !== "suspended" &&
          state.selectable
      )
      .map((state) => state.agentId)
  );
  if (selectableBuiltinIds.size === 0) {
    return null;
  }
  const preferredIds = [
    ...new Set([
      ...input.disabledControllerIds,
      ...input.projectedControllerIds,
    ]),
  ].filter((controllerId) => selectableBuiltinIds.has(controllerId));
  const selectedIds =
    preferredIds.length > 0
      ? preferredIds.slice(0, 3)
      : [...selectableBuiltinIds]
          .sort((left, right) => left.localeCompare(right))
          .slice(0, 3);
  if (selectedIds.length === 0) {
    return null;
  }
  return `openmeld agents enable --agent ${selectedIds.join(" ")}`;
}

export function mapLocalControllerStatusReason(reason: string): string {
  const missingOrDisabledReason =
    "is missing or disabled for one or more bound controllers";
  const projectedControllersDisabledReason =
    "one or more projected controllers are disabled locally";

  if (reason.includes("already exists")) {
    return "setup is already prepared";
  }
  if (reason.includes("authentication is not valid")) {
    return "sign in required";
  }
  if (reason.includes(NO_LOCAL_AGENTS_NEED_OPENMELD_SERVICE_REASON)) {
    return "no local agent is configured for this device";
  }
  if (reason.includes(missingOrDisabledReason)) {
    return "some local agents are missing or turned off";
  }
  if (reason.includes("is missing for one or more bound controllers")) {
    return "some local agents are missing";
  }
  if (reason.includes(projectedControllersDisabledReason)) {
    return "some local agent entries are disabled";
  }
  if (reason.includes("is healthy")) {
    return "status is healthy";
  }
  return reason;
}

export function describeDaemonRuntimeStatus(
  status: DaemonServiceRuntimeStatus | null
): string {
  if (!status) {
    return "No runtime status available.";
  }
  if (status.status === "running") {
    return `Service is running (${formatDaemonRunModeLabel(
      status.mode
    )}, pid=${String(status.pid)}, started=${status.startedAt || "unknown"}).`;
  }
  if (status.status === "stale") {
    return `Service status is stale (${formatDaemonRunModeLabel(
      status.mode
    )}, pid=${String(status.pid)}, reason=${status.reason || "unknown"}).`;
  }
  if (status.status === "not_running") {
    return "Service is not running.";
  }
  return "Service runtime status is unknown.";
}
