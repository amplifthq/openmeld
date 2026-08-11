import { resolvePublicAgentAvailabilityCopy } from "@openmeld/schemas";
import type {
  AgentControllerInterfaceCapabilities,
  AgentControllerInterfaceSnapshot,
} from "@openmeld/schemas/types";

export type AgentControllerInterfaceDisplayRow = {
  label: string;
  value: string;
};

export type AgentControllerVersionAdvisoryPresentation = {
  detail: string;
  label: string;
  tone: "muted" | "warning";
  updateCommand: string | null;
};

export function createAgentControllerInterfaceDisplayRows(
  snapshot: AgentControllerInterfaceSnapshot
): AgentControllerInterfaceDisplayRow[] {
  const rows: AgentControllerInterfaceDisplayRow[] = [
    {
      label: "Controller",
      value: formatAgentControllerStatus(snapshot),
    },
    {
      label: "Account",
      value: formatAgentControllerAccount(snapshot),
    },
    {
      label: "Native interface",
      value: formatAgentControllerNativeInterface(snapshot.nativeInterface),
    },
    {
      label: "Version",
      value: formatAgentControllerVersion(snapshot.version) ?? "Not reported",
    },
    {
      label: "Version status",
      value: formatAgentControllerVersionAdvisory(snapshot),
    },
    {
      label: "Launch check",
      value: formatAgentControllerLaunch(snapshot),
    },
    {
      label: "Models",
      value: formatAgentControllerModels(snapshot),
    },
    {
      label: "Capabilities",
      value: formatAgentControllerCapabilities(snapshot.capabilities),
    },
    {
      label: "Last checked",
      value: formatAgentControllerCheckedAt(snapshot.checkedAt),
    },
  ];
  if (snapshot.skills.length > 0) {
    rows.splice(7, 0, {
      label: "Skills",
      value: formatAgentControllerSkills(snapshot),
    });
  }
  if (snapshot.check?.status === "failed" && snapshot.check.lastSucceededAt) {
    const lastCheckedRowIndex = rows.findIndex(
      (row) => row.label === "Last checked"
    );
    rows.splice(
      lastCheckedRowIndex >= 0 ? lastCheckedRowIndex : rows.length,
      0,
      {
        label: "Last successful check",
        value: formatAgentControllerCheckedAt(snapshot.check.lastSucceededAt),
      }
    );
  }
  if (snapshot.message) {
    rows.splice(1, 0, {
      label: "Message",
      value: snapshot.message,
    });
  }
  if (
    snapshot.versionAdvisory?.status === "behind_latest" &&
    snapshot.versionAdvisory.updateCommand
  ) {
    const launchRowIndex = rows.findIndex(
      (row) => row.label === "Launch check"
    );
    rows.splice(launchRowIndex >= 0 ? launchRowIndex : rows.length, 0, {
      label: "Update command",
      value: snapshot.versionAdvisory.updateCommand,
    });
  }
  return rows;
}

export function resolveAgentControllerInterfaceDescription(input: {
  displayDescription: string;
  snapshot: AgentControllerInterfaceSnapshot | null;
}): string {
  if (!input.snapshot) {
    return input.displayDescription;
  }
  if (input.snapshot.check?.status === "failed") {
    return `OpenMeld couldn't finish checking ${input.snapshot.displayName}. It will try again automatically.`;
  }
  if (input.snapshot.auth.status === "unauthenticated") {
    const signInCopy = resolvePublicAgentAvailabilityCopy(
      "controller.auth.unauthenticated",
      { agentControllerId: input.snapshot.controllerId }
    );
    const genericDescription =
      signInCopy?.controllerInterfaceDescriptionFallback;
    if (!genericDescription) {
      throw new Error(
        "Shared controller sign-in copy is missing its Computers fallback"
      );
    }
    // Controller inventory can name the exact CLI/provider, so its resolver
    // message wins. Shared controller-specific copy is next, and the generic
    // shared sentence is only the final fallback.
    return (
      input.snapshot.message ??
      signInCopy?.controllerInterfaceDescription ??
      genericDescription
    );
  }
  if (input.snapshot.message) {
    return input.snapshot.message;
  }
  if (input.snapshot.status === "ready") {
    return "OpenMeld can launch this controller on this computer.";
  }
  if (input.snapshot.status === "warning") {
    return "Installed, but OpenMeld found something that needs attention.";
  }
  if (input.snapshot.status === "error") {
    return "OpenMeld could not verify this controller.";
  }
  if (input.snapshot.status === "unavailable") {
    return "Detected, but not available to run right now.";
  }
  return input.displayDescription;
}

export function shouldExpandAgentControllerInterface(
  snapshot: AgentControllerInterfaceSnapshot | null
): boolean {
  return Boolean(
    snapshot &&
      (snapshot.check?.status === "failed" ||
        snapshot.status === "warning" ||
        snapshot.status === "error" ||
        snapshot.status === "unavailable" ||
        snapshot.auth.status === "unauthenticated" ||
        snapshot.launch.status === "needs_choice" ||
        snapshot.launch.status === "needs_repair")
  );
}

export function formatAgentControllerInterfaceSummary(
  snapshot: AgentControllerInterfaceSnapshot
): string {
  if (snapshot.check?.status === "failed") {
    const version = formatAgentControllerVersion(snapshot.version);
    return version ? `Couldn't check · ${version}` : "Couldn't check";
  }
  const auth = formatAgentControllerAuthSummary(snapshot);
  const version = formatAgentControllerVersion(snapshot.version);
  if (auth && version) {
    return `${auth} · ${version}`;
  }
  return auth ?? version ?? formatAgentControllerStatus(snapshot);
}

export function getAgentControllerVersionAdvisoryPresentation(
  snapshot: AgentControllerInterfaceSnapshot | null
): AgentControllerVersionAdvisoryPresentation | null {
  const advisory = snapshot?.versionAdvisory;
  if (advisory?.status !== "behind_latest") {
    return null;
  }
  const latestVersion = formatAgentControllerVersion(advisory.latestVersion);
  return {
    detail:
      advisory.message ??
      (latestVersion
        ? `A newer version is available: ${latestVersion}.`
        : "A newer controller version is available."),
    label: "Update available",
    tone: "warning",
    updateCommand: advisory.updateCommand,
  };
}

function formatAgentControllerAuthSummary(
  snapshot: AgentControllerInterfaceSnapshot
): string | null {
  if (snapshot.auth.status === "authenticated") {
    const account = resolveAgentControllerAuthDisplayLabel(snapshot);
    return account ? `Authenticated · ${account}` : "Authenticated";
  }
  if (snapshot.auth.status === "unauthenticated") {
    return "Not authenticated";
  }
  return null;
}

function formatAgentControllerVersion(version: string | null): string | null {
  if (!version) {
    return null;
  }
  return version.startsWith("v") ? version : `v${version}`;
}

function formatAgentControllerVersionAdvisory(
  snapshot: AgentControllerInterfaceSnapshot
): string {
  const advisory = snapshot.versionAdvisory;
  if (!advisory) {
    return "Not checked";
  }
  if (advisory.status === "current") {
    const latestVersion = formatAgentControllerVersion(advisory.latestVersion);
    return latestVersion ? `Up to date · ${latestVersion}` : "Up to date";
  }
  if (advisory.status === "behind_latest") {
    const latestVersion = formatAgentControllerVersion(advisory.latestVersion);
    return latestVersion
      ? `Update available · ${latestVersion}`
      : "Update available";
  }
  return advisory.message ?? "Could not check latest version";
}

function formatAgentControllerStatus(
  snapshot: AgentControllerInterfaceSnapshot
): string {
  if (snapshot.check?.status === "failed") {
    return "Couldn't check";
  }
  switch (snapshot.status) {
    case "ready":
      return "Enabled";
    case "warning":
      return "Needs attention";
    case "error":
      return "Error";
    case "unavailable":
      return "Unavailable";
    case "disabled":
      return "Disabled";
    default:
      return "Unknown";
  }
}

function formatAgentControllerAccount(
  snapshot: AgentControllerInterfaceSnapshot
): string {
  if (snapshot.check?.status === "failed") {
    return "Not checked";
  }
  if (snapshot.auth.status === "authenticated") {
    return resolveAgentControllerAuthDisplayLabel(snapshot) ?? "Authenticated";
  }
  if (snapshot.auth.status === "unauthenticated") {
    return "Not authenticated";
  }
  return "Unknown";
}

function resolveAgentControllerAuthDisplayLabel(
  snapshot: AgentControllerInterfaceSnapshot
): string | null {
  const label = snapshot.auth.email ?? snapshot.auth.label;
  if (!label || isGenericAuthenticatedLabel(label)) {
    return null;
  }
  return label;
}

function isGenericAuthenticatedLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "signed in" || normalized === "authenticated";
}

function formatAgentControllerNativeInterface(
  value: AgentControllerInterfaceSnapshot["nativeInterface"]
): string {
  switch (value) {
    case "acp":
      return "Agent Client Protocol (ACP)";
    case "codex-app-server":
      return "Codex App Server";
    case "claude-agent-sdk":
      return "Claude Agent SDK";
    case "claude-cli":
      return "Claude CLI";
    case "local-cli":
      return "Local CLI";
    default:
      return value;
  }
}

function formatAgentControllerLaunch(
  snapshot: AgentControllerInterfaceSnapshot
): string {
  const status = formatLocalAgentLaunchStatus(snapshot.launch.status);
  const parts = [status];
  if (snapshot.launch.commandPath) {
    parts.push(snapshot.launch.commandPath);
  }
  if (snapshot.launch.installChoiceCount > 0) {
    parts.push(
      snapshot.launch.installChoiceCount === 1
        ? "1 local install found"
        : `${snapshot.launch.installChoiceCount} local installs found`
    );
  }
  return parts.join(" · ");
}

function formatLocalAgentLaunchStatus(
  status: AgentControllerInterfaceSnapshot["launch"]["status"]
): string {
  switch (status) {
    case "ready":
      return "Can launch";
    case "needs_choice":
      return "Needs install choice";
    case "needs_repair":
      return "Needs repair";
    default:
      return "Not available";
  }
}

function formatAgentControllerModels(
  snapshot: AgentControllerInterfaceSnapshot
): string {
  if (snapshot.models.length === 0) {
    return "No native model list reported";
  }
  const visibleModels = snapshot.models
    .slice(0, 4)
    .map((model) => model.displayName);
  const remaining = snapshot.models.length - visibleModels.length;
  return remaining > 0
    ? `${visibleModels.join(", ")} +${remaining} more`
    : visibleModels.join(", ");
}

function formatAgentControllerCapabilities(
  capabilities: AgentControllerInterfaceCapabilities
): string {
  const labels = [
    capabilities.approvals ? "Approvals" : null,
    capabilities.cancel ? "Cancel" : null,
    capabilities.interrupt ? "Interrupt" : null,
    capabilities.modelSelection ? "Model selection" : null,
    capabilities.nativeEventStream ? "Native event stream" : null,
    capabilities.permissionModes ? "Permission modes" : null,
    capabilities.structuredUserInput ? "Structured user input" : null,
  ].filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels.join(", ") : "No native controls reported";
}

function formatAgentControllerSkills(
  snapshot: AgentControllerInterfaceSnapshot
): string {
  const visibleSkills = snapshot.skills
    .slice(0, 4)
    .map((skill) => skill.displayName ?? skill.id);
  const remaining = snapshot.skills.length - visibleSkills.length;
  return remaining > 0
    ? `${visibleSkills.join(", ")} +${remaining} more`
    : visibleSkills.join(", ");
}

function formatAgentControllerCheckedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}
